import {Memo, useCallback, useEffect, useMemo, useState} from "react";
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

    useEffect(() => {
        const unsubscribeFromConnect = client.subscribeToConnect(() => {
            setIsConnected(true);
        });

        const unsubscribeFromDisconnect = client.subscribeToDisconnect(error => {
            setIsConnected(false);
            // NOCOMMIT
            // if (error) setErrorState({hasError: true, error});
        });

        const unsubscribeFromMessage = client.subscribeToMessage(message => {
            actuallyHandleMessage(message);
        });

        console.log("here 1");
        client.connect();
        console.log("here 2");

        return () => {
            unsubscribeFromConnect();
            unsubscribeFromDisconnect();
            unsubscribeFromMessage();

            console.log("here 3");
            client.disconnect();
            console.log("here 4");
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
