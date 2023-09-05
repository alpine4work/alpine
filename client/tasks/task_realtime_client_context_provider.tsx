import {ReactNode, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {TaskRealtimeClient} from "~/client/tasks/internal/task_realtime_client.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Runs an action against a `TaskRealtimeClient` on the client's web browser
 * outside of React. A shared `TaskRealtimeClient` instance exists at the
 * `/s/:spaceId` route which any UI which needs task data connects to. We only
 * allow one `TaskRealtimeClient` per-space per-browser to exist at a time.
 *
 * Throws an error if you call this function on the server.
 *
 * If the `TaskRealtimeClient` is available then `action` will run
 * synchronously. If `<TaskRealtimeClientContextProvider>` hasn't been mounted
 * for the provided `SpaceId` then the action will be executed later when
 * `<TaskRealtimeClientContextProvider>` mounts.
 */
export function withTaskRealtimeClientForClient(
    spaceId: SpaceId,
    action: (client: TaskRealtimeClient) => void,
) {
    assert(typeof window !== "undefined");

    const clientEntry = taskRealtimeClientBySpaceIdForClient.get(spaceId);

    if (!clientEntry) {
        taskRealtimeClientBySpaceIdForClient.set(spaceId, {
            isMounted: false,
            client: null,
            pendingActions: [action],
        });
    } else if (clientEntry.client === null) {
        clientEntry.pendingActions.push(action);
    } else {
        action(clientEntry.client);
    }
}

const taskRealtimeClientBySpaceIdForClient = new Map<
    SpaceId,
    | {
          isMounted: boolean;
          client: TaskRealtimeClient;
          pendingActions: null;
      }
    | {
          isMounted: false;
          client: null;
          pendingActions: Array<(client: TaskRealtimeClient) => void>;
      }
>();

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
    const context = useAppContext();
    const contextRef = useRef(context);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
    });

    const [client] = useState((): TaskRealtimeClient => {
        // On the server, there is no global access to the task realtime client.
        if (typeof window === "undefined") {
            return new TaskRealtimeClient(() => contextRef.current, spaceId);
        } else {
            const existingClientEntry = taskRealtimeClientBySpaceIdForClient.get(spaceId);

            // Only one `<TaskStoreContextProvider>` should be mounted at a time per-space
            // on the client. Error if another client exists and is mounted. Ok if another
            // client exists but is not mounted.
            assert(!existingClientEntry?.isMounted);

            // Reuse the existing client. Otherwise we need to create a new client.
            if (existingClientEntry?.client) return existingClientEntry.client;

            const client = new TaskRealtimeClient(() => contextRef.current, spaceId);

            if (existingClientEntry?.pendingActions) {
                for (const action of existingClientEntry.pendingActions) {
                    action(client);
                }
            }

            taskRealtimeClientBySpaceIdForClient.set(spaceId, {
                isMounted: false,
                client,
                pendingActions: null,
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
        const clientEntry = assertExists(taskRealtimeClientBySpaceIdForClient.get(spaceId));

        assert(clientEntry.client === client);
        clientEntry.isMounted = true;

        return () => {
            clientEntry.isMounted = false;
        };
    }, [client, spaceId]);

    return <>{children}</>;
}
