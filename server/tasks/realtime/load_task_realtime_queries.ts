import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {authorizeSiteAccessIfPossible} from "~/server/sites/data/authorize_site_access.js";
import {getSitePreviewIfPossible} from "~/server/sites/data/get_site_preview.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {dangerouslyGetAccountStubIfExistsWithoutAuthorization} from "~/server/spaces/dangerously_get_account_stub_if_exists_without_authorization.js";
import {getAccount} from "~/server/spaces/get_account.js";
import {authorizeTaskCollectionIndexDocAccessIfPossible} from "~/server/tasks/data/authorization/authorize_task_collection_index_doc_access_if_possible.js";
import {authorizeTaskIndexDocAccessIfPossible} from "~/server/tasks/data/authorization/authorize_task_index_doc_access_if_possible.js";
import {getTaskGridViewExpansionState} from "~/server/tasks/data/get_task_grid_view_expansion_state.js";
import {prepareTaskCollectionForClient} from "~/server/tasks/data/prepare_task_collection_for_client.js";
import {prepareTaskForClient} from "~/server/tasks/data/prepare_task_for_client.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    TaskRealtimeActionContext,
    TaskRealtimeSystemActionContext,
} from "~/server/tasks/data/task_realtime_context.js";
import {getTaskGridViewExpansionStateChildrenQueries} from "~/server/tasks/realtime/get_task_grid_view_expansion_state_children_queries.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AccountId, SiteId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {decodeApiTaskQueryCursor} from "~/shared/tasks/model/api_task_query_cursor_encoder.js";
import {collectReferencedIdsFromTaskCollectionModelData} from "~/shared/tasks/model/collect_referenced_ids_from_task_collection_model_data.js";
import {collectReferencedIdsFromTaskModelData} from "~/shared/tasks/model/collected_referenced_ids_from_task_model_data.js";
import {
    TaskQueryNormalizedFilters,
    normalizeTaskQueryFilters,
} from "~/shared/tasks/task_query_normalized_filters.js";
import {
    TaskQueryNormalizedSort,
    normalizeTaskQuerySorts,
} from "~/shared/tasks/task_query_normalized_sort.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";
import {
    TaskRealtimeQueryLoadedState,
    TaskRealtimeUpdateEvent,
    TaskRealtimeUpdateEventBackfillTask,
} from "~/shared/tasks/task_realtime_protocol.js";
import {
    TaskRealtimeLoadQueriesInputQuery,
    TaskRealtimeLoadQueriesOutputQuery,
} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";

/**
 * Loads some initial data for multiple queries without establishing a realtime
 * subscription. This is used when server-side rendering some query. Then the
 * client is expected to establish a realtime WebSocket connection to receive
 * ongoing updates.
 *
 * In addition to loading queries you may load individual `TaskId`s and
 * `TaskCollectionId`s.
 *
 * Different from `server.loadQuery()` because we run authorization checks so the
 * data is safe to return to an end user.
 *
 * Loading a query loads data from OpenSearch, catches it up with our realtime
 * action history, and puts it in our store. Data stays in the store for at least
 * 1min before it's evicted if there are no subscribers. If a client connects with
 * a WebSocket then it keeps the query and its referenced data from being evicted.
 *
 * We should return one `loadedState` for every `query`.
 */
export async function loadTaskRealtimeQueries(
    context: TaskRealtimeActionContext,
    {
        server,
        dangerouslyEscalateToSystemContext,
        spaceId,
        queries,
        taskIds,
        collectionIds,
        consistency,
    }: {
        server: TaskRealtimeServer;
        dangerouslyEscalateToSystemContext: <Value>(
            context: Context<{
                tracer: TracerContextModule;
                actor: ActorContextModule;
                cache: CacheContextModule;
                batch: BatchContextModule;
            }>,
            spaceId: SpaceId,
            action: (context: TaskRealtimeSystemActionContext) => Promise<Value>,
        ) => Promise<Value>;
        spaceId: SpaceId;
        queries: ReadonlyArray<TaskRealtimeLoadQueriesInputQuery>;
        taskIds: ReadonlyArray<TaskId>;
        collectionIds: ReadonlyArray<TaskCollectionId>;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    queries: Array<TaskRealtimeLoadQueriesOutputQuery>;
    extraQueries: Array<{
        filters: TaskQueryNormalizedFilters;
        sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        limit: number;
        loadedState: TaskRealtimeQueryLoadedState;
    }>;
    updateEvent: TaskRealtimeUpdateEvent;
}> {
    const originalContext = context;
    const {actor} = context;

    const defaultAuthorizationStateVersion: HybridLogicalTime = [Date.now(), 0];

    const backfillAuthorizedTaskSet = new Set<TaskIndexDoc>();
    const backfillUnauthorizedTaskIds = new Map<TaskId, ErrorCode>();
    const backfillAuthorizedCollectionSet = new Set<TaskCollectionIndexDoc>();
    const backfillAuthorizedCollectionIds = new Set<TaskCollectionId>();
    const backfillUnauthorizedCollectionIds = new Map<TaskCollectionId, ErrorCode>();

    const promiseWaiter = new PromiseWaiter();
    const loadTaskPromiseById = new Map<TaskId, Promise<void>>();
    const loadCollectionPromiseById = new Map<TaskCollectionId, Promise<void>>();

    const trackTaskDependencies = (
        context: TaskRealtimeSystemActionContext,
        task: TaskIndexDoc,
    ) => {
        const parentTaskId = task.parent.taskId.value;
        if (parentTaskId && !loadTaskPromiseById.has(parentTaskId)) {
            const promise = (async () => {
                const task = await server.getTask(context, spaceId, parentTaskId);

                trackTaskDependencies(context, task);

                const result = await authorizeTaskIndexDocAccessIfPossible(
                    originalContext,
                    task,
                    "View",
                    {
                        getTaskIndexDoc: taskId => server.getTask(context, spaceId, taskId),
                        getCollectionIndexDoc: collectionId =>
                            server.getCollection(context, spaceId, collectionId),
                    },
                    {consistency},
                );

                if (!result.ok) {
                    backfillUnauthorizedTaskIds.set(task.id, result.error.code);

                    // Logically, this should remove a backfilled authorized task. However we don't
                    // have a way to address authorized tasks by `TaskId` during the event building
                    // phase. So we remove conflicting tasks in the event finalization phase.
                } else {
                    backfillAuthorizedTaskSet.add(task);
                    backfillUnauthorizedTaskIds.delete(task.id);
                }
            })();

            loadTaskPromiseById.set(parentTaskId, promise);
            promiseWaiter.waitUntil(promise);
        }

        for (const {collectionId} of task.collections.raw.collections.getArray()) {
            if (loadCollectionPromiseById.has(collectionId)) continue;

            const promise = (async () => {
                const collection = await server.getCollection(context, spaceId, collectionId);

                const result = await authorizeTaskCollectionIndexDocAccessIfPossible(
                    originalContext,
                    collection,
                    "View",
                    {consistency},
                );

                if (!result.ok) {
                    backfillUnauthorizedCollectionIds.set(collection.id, result.error.code);

                    // Logically, this should remove a backfilled authorized collection. However we
                    // don't have a way to address authorized collections by `TaskCollectionId` during
                    // the event building phase. So we remove conflicting tasks in the event
                    // finalization phase.
                } else {
                    backfillAuthorizedCollectionSet.add(collection);
                    backfillAuthorizedCollectionIds.add(collection.id);
                    backfillUnauthorizedCollectionIds.delete(collection.id);
                }
            })();

            loadCollectionPromiseById.set(collectionId, promise);
            promiseWaiter.waitUntil(promise);
        }
    };

    let extraQueryPromises: Array<
        Promise<{
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
            loadedState: TaskRealtimeQueryLoadedState;
        } | null>
    > = [];

    const loadQuery = async (
        context: TaskRealtimeSystemActionContext,
        query: TaskRealtimeLoadQueriesInputQuery,
    ): Promise<TaskRealtimeLoadQueriesOutputQuery> => {
        let filtersResult:
            | {type: "Possible"; normalizedFilters: TaskQueryNormalizedFilters}
            | {type: "Impossible"};
        let sorts: ReadonlyArray<TaskQueryNormalizedSort>;
        let expensivelyAfterCursor: TaskQuerySortCursor | null;

        switch (query.type) {
            case "Normalized": {
                filtersResult = {type: "Possible", normalizedFilters: query.filters};
                sorts = query.sorts;
                expensivelyAfterCursor = query.expensivelyAfterCursor ?? null;
                break;
            }
            case "Collection": {
                const {defaults} = await server.authorizeCollectionAccess(
                    originalContext,
                    spaceId,
                    query.collectionId,
                    "View",
                    {consistency},
                );

                const inputFilters = query.filters ?? defaults.filters;
                const inputSorts = query.sorts ?? defaults.sorts;

                filtersResult = normalizeTaskQueryFilters(
                    [
                        {
                            type: "Collections",
                            operation: {
                                type: "IncludesOneOf",
                                collectionIds: new Set([query.collectionId]),
                            },
                        },
                        ...inputFilters,
                    ],
                    query.evaluationContext,
                );

                // If no filters or sorts have been explicitly set then sort by the manual
                // collection position. Otherwise a filtered view automatically applies a sort so
                // newly created tasks land somewhere predictable.
                sorts =
                    inputFilters.length === 0 && inputSorts.length === 0
                        ? [
                              {
                                  type: "CollectionPosition",
                                  direction: "Ascending",
                                  missing: "Last",
                                  collectionId: query.collectionId,
                              },
                              {
                                  type: "CreatedTime",
                                  direction: "Ascending",
                                  missing: "Last",
                              },
                          ]
                        : normalizeTaskQuerySorts(inputSorts);

                if (query.expensivelyAfterCursorForApi === undefined) {
                    expensivelyAfterCursor = null;
                } else {
                    try {
                        expensivelyAfterCursor = decodeApiTaskQueryCursor(
                            sorts,
                            query.expensivelyAfterCursorForApi,
                        );
                    } catch (error) {
                        throw InvalidArgumentError.from(error, undefined, {
                            // Throw an error with a nice display message for API clients.
                            displayMessage:
                                inputFilters.length === 0 && inputSorts.length === 0
                                    ? errorDisplayMessage`Invalid task query cursor for this collection. You may get this error if you\u2019re paginating through a task collection when the task collection\u2019s default sorts change. In that case try paginating from the start of the collection again and you\u2019ll pick up the new sorts, or try overriding the default sorts so if the default sorts change you\u2019ll be able to continue paginating.`
                                    : errorDisplayMessage`Invalid task query cursor for this collection. Try again with a task query cursor that matches the requested sorts.`,
                        });
                    }
                }
                break;
            }
            case "Children": {
                await server.authorizeTaskAccess(originalContext, spaceId, query.taskId, "View", {
                    consistency,
                });

                const inputFilters = query.filters ?? [];
                const inputSorts = query.sorts ?? [];

                filtersResult = normalizeTaskQueryFilters(
                    [
                        {
                            type: "DisplayStatus",
                            operation: {
                                type: "OneOf",
                                displayStatuses: new Set(["OpenInactive", "OpenActive", "Closed"]),
                            },
                        },
                        ...inputFilters,
                    ],
                    query.evaluationContext,
                );

                if (filtersResult.type === "Possible") {
                    filtersResult = {
                        type: "Possible",
                        normalizedFilters: {
                            ...filtersResult.normalizedFilters,
                            parentFilter: {parentTaskId: query.taskId},
                        },
                    };
                }

                sorts =
                    inputFilters.length === 0 && inputSorts.length === 0
                        ? [
                              {
                                  type: "ParentPosition",
                                  direction: "Ascending",
                                  missing: "Last",
                              },
                              {
                                  type: "CreatedTime",
                                  direction: "Ascending",
                                  missing: "Last",
                              },
                          ]
                        : normalizeTaskQuerySorts(inputSorts);

                if (query.expensivelyAfterCursorForApi === undefined) {
                    expensivelyAfterCursor = null;
                } else {
                    try {
                        expensivelyAfterCursor = decodeApiTaskQueryCursor(
                            sorts,
                            query.expensivelyAfterCursorForApi,
                        );
                    } catch (error) {
                        throw InvalidArgumentError.from(error, undefined, {
                            // Throw an error with a nice display message for API clients.
                            displayMessage: errorDisplayMessage`Invalid task query cursor for this task. Try again with a task query cursor that matches the requested sorts.`,
                        });
                    }
                }
                break;
            }
            default:
                throw exhaustive(query);
        }

        if (filtersResult.type === "Impossible") {
            return {
                loadedState: {type: "Full"},
                gridViewExpansionState: null,
                filtersResult,
                sorts,
            };
        }

        await server.authorizeQueryAccess(originalContext, {
            spaceId,
            filters: filtersResult.normalizedFilters,
            sorts,
            consistency,
        });

        const [{loadedState, tasks}, gridViewExpansionState] = await runAllPromises([
            expensivelyAfterCursor === null
                ? server.loadQuery(context, {
                      spaceId,
                      filters: filtersResult.normalizedFilters,
                      sorts,
                      limit: query.limit,
                  })
                : server.expensivelyLoadQueryAfterCursor(context, {
                      spaceId,
                      filters: filtersResult.normalizedFilters,
                      sorts,
                      limit: query.limit,
                      afterCursor: expensivelyAfterCursor,
                  }),
            query.type === "Normalized" &&
            query.shouldLoadGridViewExpandedChildTasksForBrowserId &&
            originalContext.actor.type === "Session"
                ? getTaskGridViewExpansionState(originalContext.actor.authorizeSession(), {
                      spaceId,
                      browserId: query.shouldLoadGridViewExpandedChildTasksForBrowserId,
                      filters: filtersResult.normalizedFilters,
                      sorts,
                      consistency,
                  })
                : null,
        ]);

        // All loaded tasks are authorized because we authorized query access.
        for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
            const task = tasks[taskIndex]!;

            // If another query references this task we don't have to authorize it because it's
            // a loaded task. Yay!
            if (loadTaskPromiseById.has(task.id)) {
                loadTaskPromiseById.set(task.id, Promise.resolve());
            }

            trackTaskDependencies(context, task);

            backfillAuthorizedTaskSet.add(task);
            backfillUnauthorizedTaskIds.delete(task.id);
        }

        const childrenQueryPromises = getTaskGridViewExpansionStateChildrenQueries(context, {
            server,
            spaceId,
            actor,
            limit: query.limit,
            tasks,
            gridViewExpansionState,
            loadQuery: async input => {
                const output = await loadQuery(context, input);

                return {
                    filters: input.filters,
                    sorts: input.sorts,
                    limit: input.limit,
                    loadedState: output.loadedState,
                };
            },
        });

        if (extraQueryPromises.length === 0) {
            extraQueryPromises = childrenQueryPromises;
        } else {
            for (const extraQuery of childrenQueryPromises) {
                extraQueryPromises.push(extraQuery);
            }
        }

        return {loadedState, gridViewExpansionState, filtersResult, sorts};
    };

    // Escalation is safe since we authorize that our session has access to the query
    // before using the escalated context.
    //
    // We escalate at this level to share an action cache across all query loads.
    const {queryOutputs, extraQueries} = await dangerouslyEscalateToSystemContext(
        context,
        spaceId,
        async context => {
            const [queryOutputs] = await runAllPromises([
                runAllPromises(queries.map(query => loadQuery(context, query))),
                runAllPromises(
                    taskIds.map(taskId => {
                        const promise = (async () => {
                            await server.authorizeTaskAccess(
                                originalContext,
                                spaceId,
                                taskId,
                                "View",
                                {consistency},
                            );

                            const task = await server.getTask(context, spaceId, taskId);

                            trackTaskDependencies(context, task);

                            backfillAuthorizedTaskSet.add(task);
                            backfillUnauthorizedTaskIds.delete(task.id);
                        })();

                        // If someone else references this task we don't have to authorize it because it's
                        // directly loaded.
                        if (loadTaskPromiseById.has(taskId)) {
                            loadTaskPromiseById.set(taskId, promise);
                        }

                        return promise;
                    }),
                ),
                runAllPromises(
                    collectionIds.map(collectionId => {
                        const promise = (async () => {
                            await server.authorizeCollectionAccess(
                                originalContext,
                                spaceId,
                                collectionId,
                                "View",
                                {consistency},
                            );

                            const collection = await server.getCollection(
                                context,
                                spaceId,
                                collectionId,
                            );

                            backfillAuthorizedCollectionSet.add(collection);
                            backfillAuthorizedCollectionIds.add(collection.id);
                            backfillUnauthorizedCollectionIds.delete(collection.id);
                        })();

                        // If someone else references this collection we don't have to authorize it because
                        // it's directly loaded.
                        if (loadCollectionPromiseById.has(collectionId)) {
                            loadCollectionPromiseById.set(collectionId, promise);
                        }

                        return promise;
                    }),
                ),
            ]);

            const extraQueries = await runAllPromises(extraQueryPromises);

            await promiseWaiter.wait();

            return {queryOutputs, extraQueries};
        },
    );

    const referencedAccountIds = new Set<AccountId>();
    const referencedSiteIds = new Set<SiteId>();

    const prepareContext = {
        actor,
        isSpaceAccessAuthorized: (await authorizeSpaceAccessIfPossible(originalContext, spaceId))
            .ok,
        isCollectionAccessAuthorized: async (collectionId: TaskCollectionId) =>
            backfillAuthorizedCollectionIds.has(collectionId),
        isSiteAccessAuthorized: async (siteId: SiteId) => {
            const result = await authorizeSiteAccessIfPossible(context, siteId, "View", {
                consistency,
            });

            return result?.ok ?? false;
        },
    };

    const backfillAuthorizedTasks = await runAllPromises(
        mapIterable(backfillAuthorizedTaskSet, async task => {
            const taskModel = await prepareTaskForClient(task, prepareContext);

            collectReferencedIdsFromTaskModelData(
                referencedAccountIds,
                referencedSiteIds,
                taskModel.rawData,
            );

            return {
                type: "Authorized" as const,
                task: taskModel,
            };
        }),
    );

    const backfillTasks = Array.from(
        concatIterables<TaskRealtimeUpdateEventBackfillTask>(
            backfillAuthorizedTasks,
            mapIterable(backfillUnauthorizedTaskIds, ([taskId, errorCode]) => ({
                type: "Unauthorized",
                errorCode,
                taskId,
            })),
        ),
    );

    const referenceContext = context.dynamo.unexpectStrongReadConsistency();

    const backfillAuthorizedCollections = Array.from(
        backfillAuthorizedCollectionSet,
        collection => {
            const collectionModel = prepareTaskCollectionForClient(collection);
            collectReferencedIdsFromTaskCollectionModelData(
                referencedSiteIds,
                collectionModel.rawData,
            );
            return {
                type: "Authorized" as const,
                collection: collectionModel,
            };
        },
    );

    const [referencedAccounts, referencedSites] = await runAllPromises([
        runAllPromises(
            mapIterable(referencedAccountIds, accountId =>
                prepareContext.isSpaceAccessAuthorized
                    ? getAccount(referenceContext, spaceId, accountId, {consistency})
                    : // Granting link access to a task collection means the user is implicitly granting
                      // access to the names of all referenced accounts.
                      dangerouslyGetAccountStubIfExistsWithoutAuthorization(
                          referenceContext,
                          spaceId,
                          accountId,
                      ),
            ),
        ),
        runAllPromises(
            mapIterable(
                referencedSiteIds,
                async (
                    siteId,
                ): Promise<{isPrivate: false; site: SitePreviewModel} | {isPrivate: true}> => {
                    const result = await getSitePreviewIfPossible(referenceContext, siteId, {
                        consistency,
                    });
                    return result?.ok ? {isPrivate: false, site: result.value} : {isPrivate: true};
                },
            ),
        ),
    ]);

    return {
        queries: queryOutputs,
        extraQueries: extraQueries.filter(isNonNullable),
        updateEvent: {
            type: "Update",
            actions: [],
            backfillTasks,
            // TODO(calebmer, #task-correctness): There's a correctness bug here. We don't
            // return unauthorized collections in `backfillCollections`. This is because we
            // filter out any unauthorized collection references in `prepareTaskForClient()`.
            // But if the client received the collection in a previous request, went offline,
            // the collection becomes authorized, then the client reconnects the client will
            // permanently think the collection is authorized since `TaskRealtimeService` won't
            // send an update telling the client the collection is now unauthorized. If we
            // always sent the unauthorized backfill message that would fix our correctness bug
            // but introduce a security bug!
            //
            // The security bug is an attacker could determine, by loading a query with one
            // task at a time, the unauthorized `TaskCollectionId`s referenced by a task. This
            // information could be used maliciously be an attacker (e.g. an attacker might be
            // able to intuit a manager is collecting evidence for firing someone in a private
            // collection based on seeing the `TaskCollectionId` on certain tasks). Right now
            // we're trading a correctness bug for a security bug. In the future, we should
            // find a way to fix the correctness bug without opening a security hole.
            //
            // My current idea to fix this is when the client starts a realtime connection for
            // it to send a procedure in the background with all visible `TaskCollectionId`s
            // and then the server will respond with which are authorized/unauthorized. This
            // fixes the correctness issue without introducing a security flaw. The client
            // already knows the `TaskCollectionId`s so we're not sharing any new information
            // with the client.
            backfillCollections: backfillAuthorizedCollections,
            defaultAuthorizationStateVersion,
            referencedAccounts: referencedAccounts.filter(isNonNullable),
            referencedSites: referencedSites.filter(isNonNullable),
            originClientId: null,
        },
    };
}
