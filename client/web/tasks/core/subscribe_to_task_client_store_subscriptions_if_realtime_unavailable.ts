import {AppContext} from "~/client/web/context/app_context.js";
import {indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint} from "~/client/web/tasks/core/disable_task_grid_view_animations_until_next_browser_paint.js";
import {TaskClientCollectionSubscription} from "~/client/web/tasks/core/task_client_collection_subscription.js";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {TaskClientStore} from "~/client/web/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/web/tasks/core/task_client_task_subscription.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {
    TaskRealtimeLoadQueriesInputSchema,
    TaskRealtimeLoadQueriesOutputSchema,
} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

/**
 * Accounts which don't have access to the space aren't allowed to connect to a
 * `TaskRealtimeService` WebSocket. So instead of using `TaskRealtimeClient`
 * which keeps task data up to date in realtime and manages subscriptions with
 * our backend we use this function which doesn't connect to realtime and
 * instead issues `loadQueries` requests whenever `TaskClientStore` needs new
 * data.
 *
 * This function is used for anonymous users accessing a task collection with a
 * `urlGrant`. This function:
 *
 * - Makes sure to load queries when new query subscriptions are created (e.g.
 *   when expanding a tasks children or changing filters/sorts).
 *
 * - Loads more tasks when scrolling to the bottom of a long task collection.
 */
export function subscribeToTaskClientStoreSubscriptionsIfRealtimeUnavailable(
    getContext: () => AppContext,
    {
        store,
        onDisplayError,
    }: {
        store: TaskClientStore;
        onDisplayError: (options: {title: string; error: unknown}) => void;
    },
): () => void {
    const subscriptionsStore = store.getSubscriptionsStore();

    const subscribedQueries = new Map<
        TaskClientQuery,
        {unsubscribeFromLoadMoreTaskCount: () => void}
    >();
    const subscribedTasks = new Set<TaskClientTaskSubscription>();
    const subscribedCollections = new Set<TaskClientCollectionSubscription>();

    const updateSubscriptions = () => {
        const subscriptions = subscriptionsStore.getSnapshot();

        const oldSubscribedQueries = new Set(subscribedQueries.keys());
        const oldSubscribedTasks = new Set(subscribedTasks);
        const oldSubscribedCollections = new Set(subscribedCollections);

        batchStoreUpdates(() => {
            for (const [query, {isUnsubscribing}] of subscriptions.queries) {
                if (!isUnsubscribing) {
                    if (!oldSubscribedQueries.delete(query)) {
                        assert(!subscribedQueries.has(query));
                        subscribedQueries.set(query, {
                            unsubscribeFromLoadMoreTaskCount:
                                // IMPORTANT: When `loadMoreTaskCount` updates then we reload the entire query!
                                // This is the easiest way to soundly implement infinite scrolling when
                                // realtime is unavailable.
                                //
                                // To understand why this is sound, consider the following list of tasks:
                                //
                                // - a
                                // - b
                                // - c
                                // - d
                                // - e
                                // - f
                                //
                                // Let's say the client has loaded a, b, c, and d. If the client wants the next
                                // 5 tasks after d then obviously we return e and f. However, say another user
                                // edited the task collection so that the new order of tasks is:
                                //
                                // - a
                                // - *e*
                                // - *f*
                                // - b
                                // - c
                                // - d
                                //
                                // Now if first the client asks for the next 5 tasks after d what do we do?
                                // Remember because the client hasn't received realtime updates it still thinks
                                // the task list is a, b, c, and d. Do we return zero tasks and say the task
                                // list is complete? Then we'd be presenting the client with a task list state
                                // that never existed. Another example is this:
                                //
                                // - a
                                // - *e*
                                // - b
                                // - c
                                // - d
                                // - f
                                //
                                // If the client has a, b, c, and d and they ask for the next 5 tasks returning
                                // f then saying the list is done would result in a final task list of a, b, c,
                                // d, f which likewise doesn't represent any real state the task list was in.
                                //
                                // So for now, to show the user an accurate list of tasks we refetch the entire
                                // query. The new tasks will be merged with the client's current tasks so the
                                // client sees an accurate representation of the task view.
                                //
                                // Since this isn't very efficient we may need a better long term solution. I
                                // (@calebmer) think the ideal solution is to get to a place where we're
                                // confident enough in our realtime infrastructure that we let anonymous users
                                // connect to realtime.
                                //
                                // TODO(calebmer): There's a bug here where if a task is removed then it
                                // doesn't disappear from our task query after we reload the entire task query.
                                // Since we're merging in new tasks.
                                query.loadMoreTaskCountStore.subscribe(loadSubscriptions),
                        });
                    }
                } else {
                    try {
                        store._onQueryUnsubscribed(query);
                    } catch (error) {
                        // It's most likely a bug if our store cleanup fails. Log the error and
                        // continue cleaning up.
                        getContext()
                            .tracer.getRoot()
                            .logException(
                                "Task client store cleanup query subscription failed",
                                error,
                            );
                    }
                }
            }

            for (const taskSubscriptions of subscriptions.taskSubscriptionsById.values()) {
                for (const [taskSubscription, {isUnsubscribing}] of taskSubscriptions) {
                    if (!isUnsubscribing) {
                        if (!oldSubscribedTasks.delete(taskSubscription)) {
                            subscribedTasks.add(taskSubscription);
                        }
                    } else {
                        try {
                            store._onTaskSubscriptionUnsubscribed(taskSubscription);
                        } catch (error) {
                            // It's most likely a bug if our store cleanup fails. Log the error and
                            // continue cleaning up.
                            getContext()
                                .tracer.getRoot()
                                .logException(
                                    "Task client store cleanup task subscription failed",
                                    error,
                                );
                        }
                    }
                }
            }

            for (const collectionSubscriptions of subscriptions.collectionSubscriptionsById.values()) {
                for (const [collectionSubscription, {isUnsubscribing}] of collectionSubscriptions) {
                    if (!isUnsubscribing) {
                        if (!oldSubscribedCollections.delete(collectionSubscription)) {
                            subscribedCollections.add(collectionSubscription);
                        }
                    } else {
                        try {
                            store._onCollectionSubscriptionUnsubscribed(collectionSubscription);
                        } catch (error) {
                            // It's most likely a bug if our store cleanup fails. Log the error and
                            // continue cleaning up.
                            getContext()
                                .tracer.getRoot()
                                .logException(
                                    "Task client store cleanup task collection subscription failed",
                                    error,
                                );
                        }
                    }
                }
            }
        });

        for (const query of oldSubscribedQueries) {
            const value = subscribedQueries.get(query);
            value?.unsubscribeFromLoadMoreTaskCount();
            subscribedQueries.delete(query);
        }

        for (const taskSubscription of oldSubscribedTasks) {
            subscribedTasks.delete(taskSubscription);
        }

        for (const collectionSubscription of oldSubscribedCollections) {
            subscribedCollections.delete(collectionSubscription);
        }

        loadSubscriptions();
    };

    const loadQueriesMutex = new Mutex();

    const loadSubscriptions = () => {
        // Run load query requests through a mutex lock since if there's a load queries
        // request currently running it may return the data we need.
        loadQueriesMutex
            .withLock(async () => {
                const loadQueries: Array<TaskClientQuery> = [];
                const loadTaskIds: Array<TaskId> = [];
                const loadCollectionIds: Array<TaskCollectionId> = [];

                for (const query of subscribedQueries.keys()) {
                    if (
                        query.loadedStateStore.getSnapshot() === "Unloaded" ||
                        query.loadMoreTaskCountStore.getSnapshot() > 0
                    ) {
                        loadQueries.push(query);
                    }
                }

                for (const taskSubscription of subscribedTasks) {
                    if (taskSubscription.taskEntryStore.getSnapshot().task === null) {
                        loadTaskIds.push(taskSubscription.taskId);
                    }
                }

                for (const collectionSubscription of subscribedCollections) {
                    if (
                        collectionSubscription.collectionEntryStore.getSnapshot().collection ===
                        null
                    ) {
                        loadCollectionIds.push(collectionSubscription.collectionId);
                    }
                }

                if (
                    loadQueries.length === 0 &&
                    loadTaskIds.length === 0 &&
                    loadCollectionIds.length === 0
                ) {
                    return;
                }

                const loadQueryLimits = loadQueries.map(
                    loadQuery =>
                        // If we're re-subscribing to a query that had many tasks then we want to load
                        // all those tasks back. If the query requested to load more tasks then add
                        // those on as well.
                        loadQuery.taskOrderStore.getSnapshot().length +
                        loadQuery.loadMoreTaskCountStore.getSnapshot(),
                );

                try {
                    // We directly call `fetch()` instead of making an RPC call. This is because
                    // `EdgeService` has a route that goes directly to `TaskRealtimeService`. If we
                    // made an RPC call then the RPC would first go to `AppService`, then to
                    // `TaskRealtimeService`. Adding an unnecessary extra hop.
                    const output = await fetchWithTracer(
                        getContext().tracer.getTracer(),
                        `/api/task-realtime/${store.spaceId}/loadQueries`,
                        {
                            serviceName: "TaskRealtimeService",
                            route: "/api/task-realtime/:spaceId/loadQueries",
                            method: "POST",
                            headers: {"content-type": "application/json"},
                            body: JSON.stringify(
                                TaskRealtimeLoadQueriesInputSchema.serialize({
                                    queries: loadQueries.map((query, i) => ({
                                        filters: query.filters,
                                        sorts: query.sorts,
                                        limit: loadQueryLimits[i]!,
                                    })),
                                    taskIds: loadTaskIds,
                                    collectionIds: loadCollectionIds,
                                }),
                            ),
                        },
                        async response => {
                            const body: {ok: true} | {ok: false; error: SchemaSerializedValue} =
                                await response.json();

                            if (!body.ok) {
                                throw ErrorSchema.deserialize(body.error);
                            }

                            return TaskRealtimeLoadQueriesOutputSchema.deserialize(body);
                        },
                    );

                    batchStoreUpdates(() => {
                        // Don't animate when loading new tasks into query.
                        indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint();

                        // We're currently ignoring `extraQueries` since there should be no
                        // `extraQueries` unless we set
                        // `shouldLoadGridViewExpandedChildTasksForBrowserId`. And we don't set
                        // `shouldLoadGridViewExpandedChildTasksForBrowserId` since anonymous users
                        // (which don't have access to realtime) don't support persisting grid view
                        // expansion state.
                        //
                        // If we add support for persisting grid view expansion state for actors which
                        // don't have space access then we'll need to update this here.
                        //
                        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
                        output.extraQueries;

                        for (let i = 0; i < loadQueries.length; i++) {
                            const loadQuery = loadQueries[i]!;
                            const loadQueryLimit = loadQueryLimits[i]!;
                            const queryOutput = output.queries[i]!;

                            store.loadTasksIntoQuery(loadQuery, {
                                limit: loadQueryLimit,
                                loadedState: queryOutput.loadedState,
                                previouslyBackfilledTaskIds: [],
                            });
                        }

                        store.applyUpdateEvent(output.updateEvent);
                    });
                } catch (error) {
                    onDisplayError({
                        title:
                            loadCollectionIds.length > 0 &&
                            loadSubscriptions.length === 0 &&
                            loadTaskIds.length === 0
                                ? "Couldn’t load collections"
                                : "Couldn’t load tasks",
                        error,
                    });
                }
            })
            .catch(scheduleUncaughtError);
    };

    const unsubscribe = subscriptionsStore.subscribe(updateSubscriptions);
    updateSubscriptions();

    return () => {
        unsubscribe();
    };
}
