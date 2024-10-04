import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {prepareTaskCollectionForClient} from "~/server/tasks/data/prepare_task_collection_for_client.js";
import {prepareTaskForClient} from "~/server/tasks/data/prepare_task_for_client.js";
import {TaskSystemActionContext} from "~/server/tasks/data/task_action_context.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    getTaskGridViewExpansionState,
    isTaskCollectionIndexDocAccessAuthorized,
    isTaskIndexDocAccessAuthorized,
} from "~/server/tasks/data/task_table.js";
import {getTaskGridViewExpansionStateChildrenQueries} from "~/server/tasks/realtime/get_task_grid_view_expansion_state_children_queries.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
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
    TaskRealtimeUpdateEventBackfillCollection,
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
    context: ServerSessionActionContext,
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
            }>,
            spaceId: SpaceId,
            action: (context: TaskSystemActionContext) => Promise<Value>,
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
    const actorAccountId = context.actor.getAccountId();

    const defaultAuthorizationStateVersion: HybridLogicalTime = [Date.now(), 0];

    const backfillAuthorizedTaskSet = new Set<TaskIndexDoc>();
    const backfillUnauthorizedTaskIds = new Set<TaskId>();
    const backfillAuthorizedCollectionSet = new Set<TaskCollectionIndexDoc>();
    const backfillUnauthorizedCollectionIds = new Set<TaskCollectionId>();

    const promiseWaiter = new PromiseWaiter();
    const loadTaskPromiseById = new Map<TaskId, Promise<void>>();
    const loadCollectionPromiseById = new Map<TaskCollectionId, Promise<void>>();

    const trackTaskDependencies = (context: TaskSystemActionContext, task: TaskIndexDoc) => {
        const parentTaskId = task.parent.taskId.value;
        if (parentTaskId && !loadTaskPromiseById.has(parentTaskId)) {
            const promise = (async () => {
                const task = await server.getTask(context, spaceId, parentTaskId);

                trackTaskDependencies(context, task);

                const isAccessAuthorized = await isTaskIndexDocAccessAuthorized(
                    context,
                    actorAccountId,
                    task,
                    "View",
                    {
                        getTaskIndexDoc: taskId => server.getTask(context, spaceId, taskId),
                        getCollectionIndexDoc: collectionId =>
                            server.getCollection(context, spaceId, collectionId),
                    },
                );

                if (!isAccessAuthorized) {
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

                const isAccessAuthorized = await isTaskCollectionIndexDocAccessAuthorized(
                    context,
                    actorAccountId,
                    collection,
                    "View",
                );

                if (!isAccessAuthorized) {
                    backfillUnauthorizedCollectionIds.add(collection.id);

                    // Logically, this should remove a backfilled authorized collection. However we
                    // don't have a way to address authorized collections by `TaskCollectionId`
                    // during the event building phase. So we remove conflicting tasks in the event
                    // finalization phase.
                } else {
                    backfillAuthorizedCollectionSet.add(collection);
                    backfillUnauthorizedCollectionIds.delete(collection.id);
                }
            })();

            loadCollectionPromiseById.set(collectionId, promise);
            promiseWaiter.waitUntil(promise);
        }
    };

    const sessionContext = context;

    let extraQueryPromises: Array<
        Promise<{
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
            loadedState: TaskRealtimeQueryLoadedState;
        } | null>
    > = [];

    const loadQuery = async (
        context: TaskSystemActionContext,
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
        await server.authorizeQueryAccess(sessionContext, {
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
            shouldLoadGridViewExpandedChildTasksForBrowserId
                ? getTaskGridViewExpansionState(sessionContext, {
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
            accountId: actorAccountId,
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
                                sessionContext,
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
                                sessionContext,
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

    const accountIds = new Set<AccountId>();

    const backfillTasks = Array.from(
        concatIterables<TaskRealtimeUpdateEventBackfillTask>(
            mapIterable(backfillAuthorizedTaskSet, task => {
                const taskModel = prepareTaskForClient(actorAccountId, task);

                collectReferencedAccountIdsFromTaskModelData(accountIds, taskModel.rawData);

                return {
                    type: "Authorized",
                    task: taskModel,
                };
            }),
            mapIterable(backfillUnauthorizedTaskIds, taskId => ({
                type: "Unauthorized",
                taskId,
            })),
        ),
    );

    const referencedAccounts = await runAllPromises(
        Array.from(accountIds, accountId => getAccount(context, spaceId, accountId)),
    );

    return {
        queries: queryOutputs,
        extraQueries: extraQueries.filter(isNonNullable),
        updateEvent: {
            type: "Update",
            actions: [],
            backfillTasks,
            backfillCollections: Array.from(
                concatIterables<TaskRealtimeUpdateEventBackfillCollection>(
                    mapIterable(backfillAuthorizedCollectionSet, collection => ({
                        type: "Authorized",
                        collection: prepareTaskCollectionForClient(collection),
                    })),
                    mapIterable(backfillUnauthorizedCollectionIds, collectionId => ({
                        type: "Unauthorized",
                        collectionId,
                    })),
                ),
            ),
            defaultAuthorizationStateVersion: defaultAuthorizationStateVersion,
            referencedAccounts,
            originClientId: null,
        },
    };
}
