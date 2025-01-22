import {AppContext} from "~/client/context/app_context.js";
import {indiscriminatelyDisableAllTaskGridViewAnimationsUntilNextBrowserPaint} from "~/client/tasks/core/disable_task_grid_view_animations_until_next_browser_paint.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/core/task_client_collection_subscription.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/core/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/tasks/core/task_client_task_subscription.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";
import {batchStoreUpdates} from "~/shared/store/batch_store_updates.js";
import {
    TaskRealtimeLoadQueriesInputSchema,
    TaskRealtimeLoadQueriesOutputSchema,
} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

// NOCOMMIT: Document
// NOCOMMIT: Test expanding tasks, scrolling to load more tasks, and changing filters/sorts
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

    const subscribedQueries = new Set<TaskClientQuery>();
    const subscribedTasks = new Set<TaskClientTaskSubscription>();
    const subscribedCollections = new Set<TaskClientCollectionSubscription>();

    const updateSubscriptions = () => {
        const subscriptions = subscriptionsStore.getSnapshot();

        console.log(subscriptions);

        const loadQueries: Array<TaskClientQuery> = [];
        const loadTaskIds: Array<TaskId> = [];
        const loadCollectionIds: Array<TaskCollectionId> = [];

        batchStoreUpdates(() => {
            for (const [query, {isUnsubscribing}] of subscriptions.queries) {
                if (isUnsubscribing) {
                    try {
                        store._onQueryUnsubscribed(query);
                    } catch (error) {
                        // It's most likely a bug if our store cleanup fails. Log the error and
                        // continue cleaning up.
                        getContext()
                            .tracer.getRoot()
                            .logUncaughtException(
                                "Task client store cleanup query subscription failed",
                                error,
                            );
                    }
                    continue;
                }

                if (subscribedQueries.has(query)) {
                    continue;
                }

                subscribedQueries.add(query);

                // Load the query if it hasn't been loaded yet or if the query has requested us
                // to load more tasks.
                if (
                    query.loadedStateStore.getSnapshot() === "Unloaded" ||
                    query.loadMoreTaskCountStore.getSnapshot() > 0
                ) {
                    loadQueries.push(query);
                }
            }

            for (const taskSubscriptions of subscriptions.taskSubscriptionsById.values()) {
                for (const [taskSubscription, {isUnsubscribing}] of taskSubscriptions) {
                    if (isUnsubscribing) {
                        try {
                            store._onTaskSubscriptionUnsubscribed(taskSubscription);
                        } catch (error) {
                            // It's most likely a bug if our store cleanup fails. Log the error and
                            // continue cleaning up.
                            getContext()
                                .tracer.getRoot()
                                .logUncaughtException(
                                    "Task client store cleanup task subscription failed",
                                    error,
                                );
                        }
                        continue;
                    }

                    if (subscribedTasks.has(taskSubscription)) {
                        continue;
                    }

                    subscribedTasks.add(taskSubscription);

                    // Load the task if it's not currently available.
                    if (taskSubscription.taskEntryStore.getSnapshot().task === null) {
                        loadTaskIds.push(taskSubscription.taskId);
                    }
                }
            }

            for (const collectionSubscriptions of subscriptions.collectionSubscriptionsById.values()) {
                for (const [collectionSubscription, {isUnsubscribing}] of collectionSubscriptions) {
                    if (isUnsubscribing) {
                        try {
                            store._onCollectionSubscriptionUnsubscribed(collectionSubscription);
                        } catch (error) {
                            // It's most likely a bug if our store cleanup fails. Log the error and
                            // continue cleaning up.
                            getContext()
                                .tracer.getRoot()
                                .logUncaughtException(
                                    "Task client store cleanup task collection subscription failed",
                                    error,
                                );
                        }
                        continue;
                    }

                    if (subscribedCollections.has(collectionSubscription)) {
                        continue;
                    }

                    subscribedCollections.add(collectionSubscription);

                    // Load the collection if it's not currently available.
                    if (
                        collectionSubscription.collectionEntryStore.getSnapshot().collection ===
                        null
                    ) {
                        loadCollectionIds.push(collectionSubscription.collectionId);
                    }
                }
            }
        });

        if (loadQueries.length > 0 || loadTaskIds.length > 0 || loadCollectionIds.length > 0) {
            const loadQueryLimits = loadQueries.map(
                loadQuery =>
                    // If we're re-subscribing to a query that had many tasks then we want to load
                    // all those tasks back. If the query requested to load more tasks then add
                    // those on as well.
                    loadQuery.taskOrderStore.getSnapshot().length +
                    loadQuery.loadMoreTaskCountStore.getSnapshot(),
            );

            // We directly call `fetch()` instead of making an RPC call. This is because
            // `EdgeService` has a route that goes directly to `TaskRealtimeService`. If we
            // made an RPC call then the RPC would first go to `AppService`, then to
            // `TaskRealtimeService`. Adding an unnecessary extra hop.
            fetchWithTracer(
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
            ).then(
                output => {
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
                },
                error => {
                    onDisplayError({
                        title:
                            loadCollectionIds.length > 0 &&
                            loadQueries.length === 0 &&
                            loadTaskIds.length === 0
                                ? "Couldn’t load collections"
                                : "Couldn’t load tasks",
                        error,
                    });
                },
            );
        }
    };

    const unsubscribe = subscriptionsStore.subscribe(updateSubscriptions);
    updateSubscriptions();

    return () => {
        unsubscribe();
    };
}
