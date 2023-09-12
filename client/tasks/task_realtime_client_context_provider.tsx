import {useLoaderData} from "@remix-run/react";
import {ReactNode, useContext, useEffect, useRef, useState} from "react";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {useAppContext} from "~/client/context/app_context.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {batchStoreUpdates} from "~/client/helpers/store/batch_store_updates.js";
import {getLoaderDataWithSchema} from "~/client/remix/get_loader_data_with_schema.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
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

const loaderTaskQueriesSymbol = Symbol("loaderTaskQueries");

function loadTaskQueryDataIntoClient(
    client: TaskRealtimeClient,
    loaderData: SchemaSerializedValue,
) {
    if (!isPlainObject(loaderData)) return;

    const loadTaskQueryDataSerializedValue = loaderData[loadTaskQueryDataKey];
    if (!loadTaskQueryDataSerializedValue) return;

    const loadTaskQueryData = getLoaderDataWithSchema(
        TaskStoreLoaderDataSchema,
        loadTaskQueryDataSerializedValue,
    );

    batchStoreUpdates(() => {
        const queries = client.store.createAndRetainQueries(loadTaskQueryData.queries);

        client.store.applyUpdateEvent(loadTaskQueryData.updateEvent);

        for (let i = 0; i < loadTaskQueryData.queries.length; i++) {
            const query = queries[i]!;
            const {loadedState} = loadTaskQueryData.queries[i]!;

            client.store.loadTasksIntoQuery(query, {
                loadedState,
                previouslyBackfilledTaskIds: [],
            });
        }

        (loaderData as any)[loaderTaskQueriesSymbol] = queries;

        // After 5s, release our reference to all the queries we loaded. If the UI
        // cares about a query it must call `retain()` on the query to keep it around.
        setTimeout(() => {
            batchStoreUpdates(() => {
                for (const query of queries) {
                    query.release();
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
export function clientLoaderLoadTaskQueryData(spaceId: SpaceId, data: SchemaSerializedValue) {
    const client = getTaskRealtimeClientIfExistsForClient(spaceId);
    if (client) loadTaskQueryDataIntoClient(client, data);
}

/**
 * Get the task queries loaded by this route's loader if this route loaded any
 * queries. They will be in the same order as you passed your queries into
 * `loadTaskQueryData`.
 */
export function useLoaderTaskQueriesWithoutRetaining(): Array<TaskClientQuery> {
    const loaderData = useLoaderData();
    return loaderData[loaderTaskQueriesSymbol] ?? [];
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

    // Connect the client when our store has some queries and disconnect the client
    // if the store has no remaining queries.
    useEffect(() => {
        const queriesStore = client.store.getQueriesStore();
        let queryCount = queriesStore.getSnapshot().size;

        if (queryCount > 0) {
            client.connect();
        }

        const unsubscribe = queriesStore.subscribe(() => {
            const oldQueryCount = queryCount;
            queryCount = queriesStore.getSnapshot().size;
            const newQueryCount = queryCount;

            if (oldQueryCount === 0 && newQueryCount > 0) {
                client.connect();
            }

            if (oldQueryCount > 0 && newQueryCount === 0) {
                client.disconnect();
            }
        });

        return () => {
            unsubscribe();
            if (queryCount === 0) {
                client.disconnect();
            }
        };
    }, [client]);

    return <>{children}</>;
}
