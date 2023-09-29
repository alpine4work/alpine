import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerSessionActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    prepareTaskCollectionForClient,
    prepareTaskForClient,
} from "~/server/tasks/data/task_realtime_protocol_helpers.js";
import {
    getTaskGridViewExpansionState,
    isTaskCollectionIndexDocAccessAuthorized,
    isTaskIndexDocAccessAuthorized,
} from "~/server/tasks/data/task_table.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/realtime/task_realtime_system_action_context.js";
import {generateTaskRealtimeUpdateEventNumber} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {
    AccountId,
    BrowserId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {collectReferencedAccountIdsFromTaskModelData} from "~/shared/tasks/model/collected_referenced_account_ids_from_task_model_data.js";
import {
    TaskGridViewExpansionState,
    TaskGridViewExpansionTaskState,
} from "~/shared/tasks/task_grid_view_expansion_state.js";
import {TaskQueryNormalizedFilters} from "~/shared/tasks/task_query_normalized_filters.js";
import {TaskQueryNormalizedSort} from "~/shared/tasks/task_query_normalized_sort.js";
import {
    TaskRealtimeQueryLoadedState,
    TaskRealtimeUpdateEvent,
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
            action: (context: ServerSystemActionContext) => Promise<Value>,
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
    const accountId = context.actor.getAccountId();

    // Important that we generate this event number before any asynchronous work.
    const eventNumber = generateTaskRealtimeUpdateEventNumber();

    const backfillAuthorizedTaskSet = new Set<TaskIndexDoc>();
    const backfillUnauthorizedTaskIds = new Set<TaskId>();
    const backfillAuthorizedCollectionSet = new Set<TaskCollectionIndexDoc>();
    const backfillUnauthorizedCollectionIds = new Set<TaskCollectionId>();

    let promises: Array<Promise<void>> = [];
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

                const isAccessAuthorized = await isTaskIndexDocAccessAuthorized(
                    context,
                    accountId,
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
            promises.push(promise);
            context.process.waitUntil(promise);
        }

        const collectionIds = new Set(
            task.collections.raw.collections.getArray().map(({collectionId}) => collectionId),
        );
        for (const collectionId of collectionIds) {
            if (loadCollectionPromiseById.has(collectionId)) continue;

            const promise = (async () => {
                const collection = await server.getCollection(context, spaceId, collectionId);

                const isAccessAuthorized = await isTaskCollectionIndexDocAccessAuthorized(
                    context,
                    accountId,
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
            promises.push(promise);
            context.process.waitUntil(promise);
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
        await server.authorizeQueryAccess(sessionContext, {
            spaceId,
            filters,
            sorts,
        });

        const [{loadedState, tasks}, gridViewExpansionState] = await runAllPromises([
            // NOCOMMIT: Multi-search?
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

        const taskChildrenQueryPromises: Array<
            Promise<{
                filters: TaskQueryNormalizedFilters;
                sorts: ReadonlyArray<TaskQueryNormalizedSort>;
                limit: number;
                loadedState: TaskRealtimeQueryLoadedState;
            } | null>
        > = [];

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

            // If this task is expanded then load its child tasks. If any of this task's
            // child tasks are expanded then we load all of those as well.
            //
            // A task must have at least one child task for a client to be able to expand
            // it. However, if a task loses all its children we don't update the expanded
            // state. So we double check the task still has some children before starting
            // to load child tasks.
            //
            // The way we limit the number of child tasks we load requires knowing how grid
            // view is lain out. An expanded task shows its child tasks directly below it.
            // Ideally we count child tasks against the provided `limit` for the overall
            // query because they take vertical space. However we've already loaded our
            // main task query. We still want to limit the number of child task queries
            // though.
            //
            // We make the assumption that each child task query returns at least 1 task.
            // While a task needs at least 1 child task to expand it may lose that child
            // task. So the assumption is correct most of the time but not all of the time.
            //
            // So that means we use `limit` to control the number of queries we load. If
            // limit is 50 then we assume 50 queries will return at least 50 tasks meeting
            // our limit. However, we can subtract from limit based on how far down in the
            // query we are. If our expanded task is in the 10th position, that means with
            // a limit of 50 we only need 40 more tasks. So we'll only load 40 child
            // queries.
            const taskGridViewExpansionState = gridViewExpansionState?.get(task.id);
            if (
                taskGridViewExpansionState?.isExpanded &&
                task.addedChildTaskCount - task.removedChildTaskCount > 0 &&
                taskChildrenQueryPromises.length < limit - (taskIndex + 1)
            ) {
                const addTaskChildrenQueries = (
                    taskId: TaskId,
                    taskState: TaskGridViewExpansionTaskState,
                ) => {
                    if (!taskState.isExpanded) return;

                    const childrenFilters: TaskQueryNormalizedFilters = {
                        deletedFilter: filters.deletedFilter,
                        displayStatusFilter: {
                            ifOpenInactive: true,
                            ifOpenActive: true,
                            ifClosed: true,
                        },
                        parentFilter: {
                            parentTaskId: taskId,
                        },
                    };

                    const childrenSorts: ReadonlyArray<TaskQueryNormalizedSort> = [
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
                    ];

                    const childrenQueryPromise = (async () => {
                        const task = await server.getTask(context, spaceId, taskId);

                        const isAccessAuthorized = await isTaskIndexDocAccessAuthorized(
                            context,
                            accountId,
                            task,
                            "View",
                            {
                                getTaskIndexDoc: taskId => server.getTask(context, spaceId, taskId),
                                getCollectionIndexDoc: collectionId =>
                                    server.getCollection(context, spaceId, collectionId),
                            },
                        );

                        // We may have tasks in our expansion state that the user lost access too (e.g.
                        // the task was deleted or it moved collections). Since we preload child query
                        // tasks as an optimization, ignore tasks we no longer have access to.
                        if (!isAccessAuthorized) return null;

                        return loadQuery(context, {
                            filters: childrenFilters,
                            sorts: childrenSorts,
                            limit,
                        });
                    })();

                    context.process.waitUntil(childrenQueryPromise);

                    taskChildrenQueryPromises.push(
                        childrenQueryPromise.then(queryOutput => {
                            if (!queryOutput) return null;

                            return {
                                filters: childrenFilters,
                                sorts: childrenSorts,
                                limit,
                                loadedState: queryOutput.loadedState,
                            };
                        }),
                    );

                    if (taskState.childTasks) {
                        for (const [taskId, childTaskState] of taskState.childTasks) {
                            addTaskChildrenQueries(taskId, childTaskState);
                        }
                    }
                };

                addTaskChildrenQueries(task.id, taskGridViewExpansionState);
            }
        }

        if (extraQueryPromises.length === 0) {
            extraQueryPromises = taskChildrenQueryPromises;
        } else {
            for (const extraQuery of taskChildrenQueryPromises) {
                extraQueryPromises.push(extraQuery);
            }
        }

        return {loadedState, gridViewExpansionState};
    };

    // Escalation is safe since we authorize that our session has access to
    // the query before using the escalated context.
    //
    // We escalate at this level to share an action cache across all query loads.
    const [queryOutputs] = await dangerouslyEscalateToSystemContext(context, spaceId, context =>
        runAllPromises([
            runAllPromises(queries.map(query => loadQuery(context, query))),
            runAllPromises(
                taskIds.map(taskId => {
                    const promise = (async () => {
                        await server.authorizeTaskAccess(sessionContext, spaceId, taskId, "View");

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
        ]),
    );

    const extraQueries = await runAllPromises(extraQueryPromises);

    let hasError = false;
    let error: unknown;

    // Wait for all discovered promises to resolve before returning.
    //
    // Even if there's an error. Only throw our error at the very end.
    while (promises.length > 0) {
        const currentPromises = promises;
        promises = [];

        try {
            await runAllPromises(currentPromises);
        } catch (newError) {
            if (!hasError) {
                hasError = true;
                error = newError;
            }
            // TODO(calebmer, #aggregate-error): Log all rejections in our telemetry, not
            // just the first one. Probably by using an `AggregateError`.
            else if (!isSystemError(error) && isSystemError(newError)) {
                error = newError;
            }
        }
    }

    if (hasError) throw error;

    const backfillAuthorizedTasks = Array.from(backfillAuthorizedTaskSet, task =>
        prepareTaskForClient(accountId, task),
    );

    const backfillAuthorizedCollections = Array.from(backfillAuthorizedCollectionSet, collection =>
        prepareTaskCollectionForClient(collection),
    );

    const accountIds = new Set<AccountId>();

    for (const task of backfillAuthorizedTasks) {
        collectReferencedAccountIdsFromTaskModelData(accountIds, task.rawData);
    }

    const referencedAccounts = await runAllPromises(
        Array.from(accountIds, accountId => getAccount(context, spaceId, accountId)),
    );

    return {
        queries: queryOutputs,
        extraQueries: extraQueries.filter(isNonNullable),
        updateEvent: {
            type: "Update",
            number: eventNumber,
            actions: [],
            backfillAuthorizedTasks,
            backfillUnauthorizedTaskIds: Array.from(backfillUnauthorizedTaskIds),
            backfillAuthorizedCollections,
            backfillUnauthorizedCollectionIds: Array.from(backfillUnauthorizedCollectionIds),
            referencedAccounts,
        },
    };
}
