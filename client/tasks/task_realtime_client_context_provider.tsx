import {useLoaderData} from "@remix-run/react";
import {ReactNode, createContext, useContext, useEffect, useRef, useState} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {useAccountClientStore} from "~/client/accounts/account_client_store_context_provider.js";
import {useAppContext} from "~/client/context/app_context.js";
import {useShowToast} from "~/client/design/toast.js";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema.js";
import {TaskClientCollectionSubscription} from "~/client/tasks/task_client_collection_subscription.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {TaskClientTaskSubscription} from "~/client/tasks/task_client_task_subscription.js";
import {TaskRealtimeClient} from "~/client/tasks/task_realtime_client.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {countIterable} from "~/shared/helpers/iterable/count_iterable.js";
import {flatIterable} from "~/shared/helpers/iterable/flat_iterable.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {taskStoreLoaderDataKey} from "~/shared/remix/json_with_schema_shared.js";
import {TaskStoreLoaderDataSchema} from "~/shared/remix/task_store_loader_data.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

const taskRealtimeClientBySpaceIdForClient =
    typeof window !== "undefined"
        ? new Map<SpaceId, {isMounted: boolean; client: TaskRealtimeClient}>()
        : null;

/**
 * Gets the `TaskRealtimeClient` for the provided `SpaceId` if it exists.
 * Useful for operating on the `TaskRealtimeClient` outside of React. Only runs
 * in a client's web browser.
 *
 * We have a constraint that a client's web browser may only have one
 * `TaskRealtimeClient` per-space at a time. `TaskRealtimeClient` is owned by
 * the `<TaskRealtimeClientContextProvider>` component which enforces this
 * constraint.
 */
function getTaskRealtimeClientIfExistsForClient(spaceId: SpaceId): TaskRealtimeClient | null {
    assert(typeof window !== "undefined");
    assert(taskRealtimeClientBySpaceIdForClient);
    return taskRealtimeClientBySpaceIdForClient.get(spaceId)?.client ?? null;
}

const taskStoreLoaderDataSymbol = Symbol("taskStoreLoaderData");

function loadTaskDataIntoClient(client: TaskRealtimeClient, loaderData: SchemaSerializedValue) {
    if (!isPlainObject(loaderData)) return;

    const taskStoreLoaderDataSerializedValue = loaderData[taskStoreLoaderDataKey];
    if (!taskStoreLoaderDataSerializedValue) return;

    const taskStoreLoaderData = getLoaderDataWithSchema(
        TaskStoreLoaderDataSchema,
        taskStoreLoaderDataSerializedValue,
    );

    batchStoreUpdates(() => {
        const queries = client.store.createAndRetainQueries(taskStoreLoaderData.queries);

        const taskSubscriptions = taskStoreLoaderData.taskIds.map(taskId =>
            client.store.createAndRetainTaskSubscription(taskId),
        );
        const collectionSubscriptions = taskStoreLoaderData.collectionIds.map(collectionId =>
            client.store.createAndRetainCollectionSubscription(collectionId),
        );

        client.store.applyUpdateEvent(taskStoreLoaderData.updateEvent);

        for (let i = 0; i < taskStoreLoaderData.queries.length; i++) {
            const query = queries[i]!;
            const {limit, loadedState} = taskStoreLoaderData.queries[i]!;

            client.store.loadTasksIntoQuery(query, {
                limit,
                loadedState,
                previouslyBackfilledTaskIds: [],
            });
        }

        (loaderData as any)[taskStoreLoaderDataSymbol] = {
            queries,
            taskSubscriptions,
            collectionSubscriptions,
        };

        // After 5s, release our reference to all the queries we loaded. If the UI
        // cares about a query it must call `retain()` on the query to keep it around.
        setTimeout(() => {
            batchStoreUpdates(() => {
                for (const query of queries) {
                    query.release();
                }

                for (const taskSubscription of taskSubscriptions) {
                    taskSubscription.release();
                }

                for (const collectionSubscription of collectionSubscriptions) {
                    collectionSubscription.release();
                }
            });
        }, 1000 * 5);
    });
}

/**
 * Function that should be called by `clientLoader` for any route that returns
 * data in the `loadTaskQueryData` shared key.
 *
 * On initial render `<TaskRealtimeClientContextProvider>` loads data from
 * `loadTaskQueryData` into our `TaskRealtimeClient`. However on subsequent
 * client navigations, we need to imperatively update `TaskRealtimeClient`
 * before the render so data is available.
 *
 * We use the `clientLoader` feature we've added to Remix to imperatively
 * update `TaskRealtimeClient` before a render.
 * `<TaskRealtimeClientContextProvider>` lives on `/s/:spaceId` but we can't
 * use the `/s/:spaceId` route's `clientLoader` since `/s/:spaceId` doesn't
 * revalidate unless the `SpaceId` changes. So it's the route which loaded
 * `loadTaskQueryData`'s responsibility to imperatively update
 * `TaskRealtimeClient` in their `clientLoader`. You can perform this update
 * with this function.
 */
export function clientLoaderTaskStoreLoaderData(spaceId: SpaceId, data: SchemaSerializedValue) {
    const client = getTaskRealtimeClientIfExistsForClient(spaceId);
    if (client) loadTaskDataIntoClient(client, data);
}

/**
 * Get the task queries loaded by this route's loader if this route loaded any
 * queries. They will be in the same order as you passed your queries into
 * `loadTaskQueryData`.
 */
export function useTaskStoreLoaderDataWithoutRetaining(): {
    queries: Array<TaskClientQuery>;
    taskSubscriptions: Array<TaskClientTaskSubscription>;
    collectionSubscriptions: Array<TaskClientCollectionSubscription>;
} {
    const loaderData = useLoaderData();
    return (
        loaderData[taskStoreLoaderDataSymbol] ?? {
            queries: [],
            taskSubscriptions: [],
            collectionSubscriptions: [],
        }
    );
}

const TaskClientStoreContext = createContext<TaskClientStore | null>(null);

/**
 * Get the `TaskClientStore` in our React context. Maybe only be used from a
 * space route.
 */
export function useTaskClientStore(): TaskClientStore {
    const store = useContext(TaskClientStoreContext);

    if (!store) {
        throw new InternalError(
            "Expected component to be rendered inside a `<TaskRealtimeClientContextProvider>`",
        );
    }

    return store;
}

/**
 * The task realtime client lives at the space route (`/s/:spaceId`) so the
 * client is available to any UI that needs it in the space.
 */
export function TaskRealtimeClientContextProvider({
    spaceId,
    children,
}: {
    spaceId: SpaceId;
    children: ReactNode;
}) {
    const dataRouterStateContext = useContext(DataRouterStateContext);
    assert(dataRouterStateContext, "Expected data router state context");

    const context = useAppContext();
    const contextRef = useRef(context);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
    });

    const showToast = useShowToast();

    const accountStore = useAccountClientStore();

    const [client] = useState((): TaskRealtimeClient => {
        const initializeClient = () => {
            const client = new TaskRealtimeClient(() => contextRef.current, {
                // The account store has a similar lifetime to our `TaskRealtimeClient`. On the
                // client it's a shared global reference that never changes. So we won't have
                // to reinitialize `TaskRealtimeClient` when the account store changes since
                // the account store doesn't change.
                accountStore,
                spaceId,
                onDisplayError: ({title, error}) => showToast({type: "Error", title, error}),
            });

            for (const loaderData of Object.values(dataRouterStateContext.loaderData)) {
                loadTaskDataIntoClient(client, loaderData);
            }

            return client;
        };

        // On the server, there is no global access to the task realtime client.
        if (typeof window === "undefined") {
            return initializeClient();
        } else {
            assert(taskRealtimeClientBySpaceIdForClient);

            const existingClientEntry = taskRealtimeClientBySpaceIdForClient.get(spaceId);

            // Reuse the existing client. Otherwise we need to create a new client.
            if (existingClientEntry?.client) return existingClientEntry.client;

            const client = initializeClient();

            taskRealtimeClientBySpaceIdForClient.set(spaceId, {
                isMounted: false,
                client,
            });

            return client;
        }
    });

    if (client.spaceId !== spaceId) {
        throw new InternalError(
            "Can't change initial `SpaceId` passed into `<TaskStoreContextProvider>`, must remount the component",
        );
    }

    // Connect the client when our store has some queries and disconnect the client
    // if the store has no remaining queries.
    useEffect(() => {
        const clientEntry = assertExists(taskRealtimeClientBySpaceIdForClient?.get(spaceId));

        assert(clientEntry.client === client);

        // Only one `<TaskStoreContextProvider>` should be mounted at a time per-space
        // on the client. Error if another client exists and is mounted. Ok if another
        // client exists but is not mounted.
        assert(!clientEntry.isMounted);
        clientEntry.isMounted = true;

        const subscriptionsStore = client.store.getSubscriptionsStore();

        const getSubscriptionCount = () => {
            const subscriptions = subscriptionsStore.getSnapshot();
            return (
                subscriptions.queries.size +
                countIterable(flatIterable(subscriptions.taskSubscriptionsById.values())) +
                countIterable(flatIterable(subscriptions.collectionSubscriptionsById.values()))
            );
        };

        let subscriptionCount = getSubscriptionCount();

        if (subscriptionCount > 0) {
            client.connect();
        }

        const unsubscribe = subscriptionsStore.subscribe(() => {
            const oldSubscriptionCount = subscriptionCount;
            subscriptionCount = getSubscriptionCount();
            const newSubscriptionCount = subscriptionCount;

            if (oldSubscriptionCount === 0 && newSubscriptionCount > 0) {
                client.connect();
            }

            if (oldSubscriptionCount > 0 && newSubscriptionCount === 0) {
                client.disconnect();
            }
        });

        return () => {
            clientEntry.isMounted = false;

            unsubscribe();

            if (subscriptionCount > 0) {
                client.disconnect();
            }
        };
    }, [client, spaceId]);

    useDevConsoleTool("tasks", () => ({store: client.store}));

    return (
        <TaskClientStoreContext.Provider value={client.store}>
            {children}
        </TaskClientStoreContext.Provider>
    );
}
