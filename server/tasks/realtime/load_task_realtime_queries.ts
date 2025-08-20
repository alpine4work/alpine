import {DynamoActorContextModule} from "~/server/context/dynamo_actor_context_module.js";
import {
    authorizeSpaceAccessIfPossible,
    dangerouslyGetAccountStubIfExistsWithoutAuthorization,
    getAccount,
} from "~/server/spaces/spaces_table.js";
import {prepareTaskCollectionForClient} from "~/server/tasks/data/prepare_task_collection_for_client.js";
import {prepareTaskForClient} from "~/server/tasks/data/prepare_task_for_client.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    TaskRealtimeActionContext,
    TaskRealtimeSystemActionContext,
} from "~/server/tasks/data/task_realtime_context.js";
import {
    authorizeTaskCollectionIndexDocAccessIfPossibleForActor,
    authorizeTaskIndexDocAccessIfPossibleForActor,
    getTaskGridViewExpansionState,
} from "~/server/tasks/data/task_table.js";
import {getTaskGridViewExpansionStateChildrenQueries} from "~/server/tasks/realtime/get_task_grid_view_expansion_state_children_queries.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {
    AccountId,
    BrowserId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {collectReferencedAccountIdsFromTaskModelData} from "~/shared/tasks/model/collected_referenced_account_ids_from_task_model_data.js";
import {TaskGridViewExpansionState} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskRealtimeQueryLoadedState,
    TaskRealtimeUpdateEvent,
    TaskRealtimeUpdateEventBackfillTask,
} from "~/shared/tasks/task_realtime_protocol.js";

/**
 * Loads some initial data for multiple queries without establishing a realtime
 * subscription. This is used when server-side rendering some query. Then the
 * client is expected to establish a realtime WebSocket connection to receive
 * ongoing updates.
 *
 * In addition to loading queries you may load individual `TaskId`s and
 * `TaskCollectionId`s.
 *
 * Different from `server.loadQuery()` because we run authorization checks so
 * the data is safe to return to an end user.
 *
 * Loading a query loads data from OpenSearch, catches it up with our realtime
 * action history, and puts it in our store. Data stays in the store for at
 * least 1min before it's evicted if there are no subscribers. If a client
 * connects with a WebSocket then it keeps the query and its referenced data
 * from being evicted.
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
    }: {
        server: TaskRealtimeServer;
        dangerouslyEscalateToSystemContext: <Value>(
            context: Context<{
                tracer: TracerContextModule;
                actor: DynamoActorContextModule;
                cache: CacheContextModule;
                batch: BatchContextModule;
            }>,
            spaceId: SpaceId,
            action: (context: TaskRealtimeSystemActionContext) => Promise<Value>,
        ) => Promise<Value>;
        spaceId: SpaceId;
        queries: ReadonlyArray<{
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
            shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
        }>;
        taskIds: ReadonlyArray<TaskId>;
        collectionIds: ReadonlyArray<TaskCollectionId>;
    },
): Promise<{
    queries: Array<{
        loadedState: TaskRealtimeQueryLoadedState;
        gridViewExpansionState: TaskGridViewExpansionState | null;
    }>;
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
    const backfillUnauthorizedTaskIds = new Set<TaskId>();
    const backfillAuthorizedCollectionSet = new Set<TaskCollectionIndexDoc>();
    const backfillAuthorizedCollectionIds = new Set<TaskCollectionId>();
    const backfillUnauthorizedCollectionIds = new Set<TaskCollectionId>();

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

                const result = await authorizeTaskIndexDocAccessIfPossibleForActor(
                    context,
                    actor,
                    task,
                    "View",
                    {
                        getTaskIndexDoc: taskId => server.getTask(context, spaceId, taskId),
                        getCollectionIndexDoc: collectionId =>
                            server.getCollection(context, spaceId, collectionId),
                    },
                );

                if (!result.ok) {
                    backfillUnauthorizedTaskIds.add(task.id);

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

                const result = await authorizeTaskCollectionIndexDocAccessIfPossibleForActor(
                    context,
                    actor,
                    collection,
                    "View",
                );

                if (!result.ok) {
                    backfillUnauthorizedCollectionIds.add(collection.id);

                    // Logically, this should remove a backfilled authorized collection. However we
                    // don't have a way to address authorized collections by `TaskCollectionId`
                    // during the event building phase. So we remove conflicting tasks in the event
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
        {
            filters,
            sorts,
            limit,
            shouldLoadGridViewExpandedChildTasksForBrowserId,
        }: {
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
            shouldLoadGridViewExpandedChildTasksForBrowserId?: BrowserId;
        },
    ) => {
        await server.authorizeQueryAccess(originalContext, {
            spaceId,
            filters,
            sorts,
        });

        const [{loadedState, tasks}, gridViewExpansionState] = await runAllPromises([
            server.loadQuery(context, {
                spaceId,
                filters,
                sorts,
                limit,
            }),
            shouldLoadGridViewExpandedChildTasksForBrowserId &&
            originalContext.actor.type === "Session"
                ? getTaskGridViewExpansionState(originalContext.actor.authorizeSession(), {
                      spaceId,
                      browserId: shouldLoadGridViewExpandedChildTasksForBrowserId,
                      filters,
                      sorts,
                  })
                : null,
        ]);

        // All loaded tasks are authorized because we authorized query access.
        for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
            const task = tasks[taskIndex]!;

            // If another query references this task we don't have to authorize it because
            // it's a loaded task. Yay!
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
            limit,
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
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            extraQueryPromises = childrenQueryPromises;
        } else {
            for (const extraQuery of childrenQueryPromises) {
                extraQueryPromises.push(extraQuery);
            }
        }

        return {loadedState, gridViewExpansionState};
    };

    // Escalation is safe since we authorize that our session has access to
    // the query before using the escalated context.
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
                            );

                            const task = await server.getTask(context, spaceId, taskId);

                            trackTaskDependencies(context, task);

                            backfillAuthorizedTaskSet.add(task);
                            backfillUnauthorizedTaskIds.delete(task.id);
                        })();

                        // If someone else references this task we don't have to authorize it because
                        // it's directly loaded.
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

                        // If someone else references this collection we don't have to authorize it
                        // because it's directly loaded.
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

    const prepareContext = {
        actor,
        isSpaceAccessAuthorized: (await authorizeSpaceAccessIfPossible(originalContext, spaceId))
            .ok,
        isCollectionAccessAuthorized: async (collectionId: TaskCollectionId) =>
            backfillAuthorizedCollectionIds.has(collectionId),
    };

    const backfillAuthorizedTasks = await runAllPromises(
        mapIterable(backfillAuthorizedTaskSet, async task => {
            const taskModel = await prepareTaskForClient(task, prepareContext);

            collectReferencedAccountIdsFromTaskModelData(referencedAccountIds, taskModel.rawData);

            return {
                type: "Authorized" as const,
                task: taskModel,
            };
        }),
    );

    const backfillTasks = Array.from(
        concatIterables<TaskRealtimeUpdateEventBackfillTask>(
            backfillAuthorizedTasks,
            mapIterable(backfillUnauthorizedTaskIds, taskId => ({
                type: "Unauthorized",
                taskId,
            })),
        ),
    );

    const referencedAccounts = await runAllPromises(
        mapIterable(referencedAccountIds, accountId =>
            prepareContext.isSpaceAccessAuthorized
                ? getAccount(context, spaceId, accountId)
                : // Granting link access to a task collection means the user is implicitly
                  // granting access to the names of all referenced accounts.
                  dangerouslyGetAccountStubIfExistsWithoutAuthorization(
                      context,
                      spaceId,
                      accountId,
                  ),
        ),
    );

    return {
        queries: queryOutputs,
        extraQueries: extraQueries.filter(isNonNullable),
        updateEvent: {
            type: "Update",
            actions: [],
            backfillTasks,
            // TODO(calebmer, #task-correctness): There's a correctness bug here. We don't
            // return unauthorized collections in `backfillCollections`. This is because we
            // filter out any unauthorized collection references in
            // `prepareTaskForClient()`. But if the client received the collection in a
            // previous request, went offline, the collection becomes authorized, then the
            // client reconnects the client will permanently think the collection is
            // authorized since `TaskRealtimeService` won't send an update telling the
            // client the collection is now unauthorized. If we always sent the
            // unauthorized backfill message that would fix our correctness bug but
            // introduce a security bug!
            //
            // The security bug is an attacker could determine, by loading a query with one
            // task at a time, the unauthorized `TaskCollectionId`s referenced by a task.
            // This information could be used maliciously be an attacker (e.g. an attacker
            // might be able to intuit a manager is collecting evidence for firing someone
            // in a private collection based on seeing the `TaskCollectionId` on certain
            // tasks). Right now we're trading a correctness bug for a security bug. In the
            // future, we should find a way to fix the correctness bug without opening a
            // security hole.
            //
            // My current idea to fix this is when the client starts a realtime connection
            // for it to send a procedure in the background with all visible
            // `TaskCollectionId`s and then the server will respond with which are
            // authorized/unauthorized. This fixes the correctness issue without
            // introducing a security flaw. The client already knows the
            // `TaskCollectionId`s so we're not sharing any new information with the
            // client.
            backfillCollections: Array.from(backfillAuthorizedCollectionSet, collection => ({
                type: "Authorized",
                collection: prepareTaskCollectionForClient(collection),
            })),
            defaultAuthorizationStateVersion,
            referencedAccounts: referencedAccounts.filter(isNonNullable),
            originClientId: null,
        },
    };
}
