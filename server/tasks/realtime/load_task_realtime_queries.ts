import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerSessionActionContext,
    ServerSystemActionContext,
} from "~/server/context/server_action_context.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskIndexDoc} from "~/server/tasks/data/task_index_doc.js";
import {
    isTaskCollectionIndexDocAccessAuthorized,
    isTaskIndexDocAccessAuthorized,
} from "~/server/tasks/data/task_table.js";
import {
    collectReferencedAccountIdsFromTaskModelData,
    prepareTaskCollectionForClient,
    prepareTaskForClient,
} from "~/server/tasks/realtime/task_realtime_protocol_helpers.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/realtime/task_realtime_system_action_context.js";
import {generateTaskRealtimeUpdateEventNumber} from "~/server/tasks/realtime/task_realtime_update_event_builder.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId, SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
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
    }: {
        server: TaskRealtimeServer;
        dangerouslyEscalateToSystemContext: <Value>(
            context: Context<{tracer: TracerContextModule; actor: DynamoActorContextModule}>,
            spaceId: SpaceId,
            action: (context: ServerSystemActionContext) => Promise<Value>,
        ) => Promise<Value>;
        spaceId: SpaceId;
        queries: ReadonlyArray<{
            filters: TaskQueryNormalizedFilters;
            sorts: ReadonlyArray<TaskQueryNormalizedSort>;
            limit: number;
        }>;
    },
): Promise<{
    loadedStates: Array<TaskRealtimeQueryLoadedState>;
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

    const loadedStates = await runAllPromises(
        queries.map(async ({filters, sorts, limit}) => {
            await server.authorizeQueryAccess(context, {spaceId, filters, sorts});

            // Escalation is safe since we've authorized that our session has access to
            // the query.
            return dangerouslyEscalateToSystemContext(context, spaceId, async context => {
                const {loadedState, tasks} = await server.loadQuery(context, {
                    spaceId,
                    filters,
                    sorts,
                    limit,
                });

                // All loaded tasks are authorized because we authorized query access.
                for (const task of tasks) {
                    // If another query references this task we don't have to authorize it because
                    // it's a loaded task. Yay!
                    if (loadTaskPromiseById.has(task.id)) {
                        loadTaskPromiseById.set(task.id, Promise.resolve());
                    }

                    trackTaskDependencies(context, task);

                    backfillAuthorizedTaskSet.add(task);
                    backfillUnauthorizedTaskIds.delete(task.id);
                }

                return loadedState;
            });
        }),
    );

    // Wait for all discovered promises to resolve before returning.
    while (promises.length > 0) {
        const currentPromises = promises;
        promises = [];
        await runAllPromises(currentPromises);
    }

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
        loadedStates,
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
