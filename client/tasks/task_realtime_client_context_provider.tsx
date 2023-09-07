import {ReactNode, createContext, useContext, useEffect, useRef, useState} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {useAppContext} from "~/client/context/app_context.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {TaskRealtimeClient} from "~/client/tasks/task_realtime_client.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {loadTaskQueryDataKey} from "~/shared/remix/json_with_schema_shared.js";
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

function loadTaskQueryDataIntoClient(
    client: TaskRealtimeClient,
    serializedData: SchemaSerializedValue,
) {
    if (!isPlainObject(serializedData)) return;

    const loadTaskQueryDataSerializedValue = serializedData[loadTaskQueryDataKey];
    if (!loadTaskQueryDataSerializedValue) return;

    const loadTaskQueryData = getLoaderDataWithSchema(
        TaskStoreLoaderDataSchema,
        loadTaskQueryDataSerializedValue,
    );

    batchStoreUpdates(() => {
        for (const query of loadTaskQueryData.queries) {
            client.store.createQuery(query);
        }

        client.store.applyUpdateEvent(loadTaskQueryData.updateEvent);

        for (const query of loadTaskQueryData.queries) {
            client.store.loadTasksIntoQuery(query.id, {
                loadedState: query.loadedState,
                previouslyBackfilledTaskIds: [],
            });
        }
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
export function clientLoaderLoadTaskQueryData(spaceId: SpaceId, data: SchemaSerializedValue) {
    const client = getTaskRealtimeClientIfExistsForClient(spaceId);
    if (client) loadTaskQueryDataIntoClient(client, data);
}

const TaskRealtimeClientContext = createContext<TaskClientStore | null>(null);

/**
 * Get the task client store from context.
 */
export function useTaskClientStore() {
    const store = useContext(TaskRealtimeClientContext);
    if (!store) {
        throw new InternalError(
            "Must be rendered in a `<TaskRealtimeClientContextProvider>` component to access the task client store",
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
    assert(
        !useContext(TaskRealtimeClientContext),
        "Can't nest `<TaskRealtimeClientContextProvider>` components",
    );

    const dataRouterStateContext = useContext(DataRouterStateContext);
    assert(dataRouterStateContext, "Expected data router state context");

    const context = useAppContext();
    const contextRef = useRef(context);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
    });

    const [client] = useState((): TaskRealtimeClient => {
        const initializeClient = () => {
            const client = new TaskRealtimeClient(() => contextRef.current, spaceId);

            for (const loaderData of Object.values(dataRouterStateContext.loaderData)) {
                loadTaskQueryDataIntoClient(client, loaderData);
            }

            return client;
        };

        // On the server, there is no global access to the task realtime client.
        if (typeof window === "undefined") {
            return initializeClient();
        } else {
            assert(taskRealtimeClientBySpaceIdForClient);

            const existingClientEntry = taskRealtimeClientBySpaceIdForClient.get(spaceId);

            // Only one `<TaskStoreContextProvider>` should be mounted at a time per-space
            // on the client. Error if another client exists and is mounted. Ok if another
            // client exists but is not mounted.
            assert(!existingClientEntry?.isMounted);

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

    // Mark our client entry as mounted and error if another entry was added. This
    // means two `<TaskStoreContextProvider>` are mounting at the same time.
    useEffect(() => {
        const clientEntry = assertExists(taskRealtimeClientBySpaceIdForClient?.get(spaceId));

        assert(clientEntry.client === client);
        clientEntry.isMounted = true;

        return () => {
            clientEntry.isMounted = false;
        };
    }, [client, spaceId]);

    return (
        <TaskRealtimeClientContext.Provider value={client.store}>
            {children}
        </TaskRealtimeClientContext.Provider>
    );
}
