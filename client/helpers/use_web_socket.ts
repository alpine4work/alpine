import {Memo, useCallback, useMemo, useState} from "react";
import {useEffectWithoutStrictModeUnmountSimulation} from "~/client/helpers/lifecycle/use_effect_without_strict_mode_unmount_simulation";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {WebSocketClient} from "~/client/helpers/web_socket_client";
import {UnionSchema} from "~/shared/schema/schema";

/**
 * React hook for connecting to a WebSocket using our `WebSocketClient`
 * abstraction.
 */
export function useWebSocket<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
>(
    messageFromClientSchema: UnionSchema<MessageFromClient>,
    messageFromServerSchema: UnionSchema<MessageFromServer>,
    url: string,
    handleMessage: (message: MessageFromServer) => void,
): {
    isConnected: boolean;
    sendMessage: Memo<(message: MessageFromClient) => void>;
} {
    const client = useMemo(
        () => new WebSocketClient(messageFromClientSchema, messageFromServerSchema, url),
        [messageFromClientSchema, messageFromServerSchema, url],
    );

    const [isConnected, setIsConnected] = useState(false);
    const actuallyHandleMessage = useEvent(handleMessage);

    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    // Escalate WebSocket network errors to component errors which crash the UI.
    // Some WebSocket errors are transient and ok to ignore. Like temporarily
    // losing internet. We do not throw these errors.
    if (errorState.hasError) throw errorState.error;

    // Chrome logs a warning when we close a WebSocket we just opened (which
    // happens with React strict mode effect unmount simulation). So disable
    // unmount simulation for this hook.
    //
    // We believe the hook is well written to handle unmounts. The Chrome log is
    // only a warning.
    useEffectWithoutStrictModeUnmountSimulation(() => {
        const unsubscribeFromConnect = client.subscribeToConnect(() => {
            setIsConnected(true);
        });

        const unsubscribeFromDisconnect = client.subscribeToDisconnect(error => {
            setIsConnected(false);
            if (error) setErrorState({hasError: true, error});
        });

        const unsubscribeFromMessage = client.subscribeToMessage(message => {
            actuallyHandleMessage(message);
        });

        client.connect();

        return () => {
            unsubscribeFromConnect();
            unsubscribeFromDisconnect();
            unsubscribeFromMessage();

            client.disconnect();
        };
    }, [actuallyHandleMessage, client]);

    const sendMessage = useCallback(
        (message: MessageFromClient) => client.sendMessage(message),
        [client],
    );

    return {
        isConnected,
        sendMessage,
    };
}
