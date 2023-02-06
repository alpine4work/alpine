import {Memo, useCallback, useEffect, useMemo, useState} from "react";
import {WebSocketClient} from "~/client/cloudflare/web_socket_client";
import {useAppContext} from "~/client/context/app_context";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {UnionSchema} from "~/shared/schema/schema";

/**
 * React hook for connecting to a WebSocket using our `WebSocketClient`
 * abstraction.
 *
 * Automatically disconnects the WebSocket when the user hides the web page so
 * we don't continue to send ping/pong events.
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
    sendMessage: Memo<(message: MessageFromClient) => Promise<void>>;
    toggleShouldConnect: () => void;
} {
    const context = useAppContext();

    const client = useMemo(
        () => new WebSocketClient(context, messageFromClientSchema, messageFromServerSchema, url),
        [context, messageFromClientSchema, messageFromServerSchema, url],
    );

    const [shouldConnect, setShouldConnect] = useState(true);
    const [isDocumentVisible, setIsDocumentVisible] = useState(true);
    const [isConnected, setIsConnected] = useState(false);
    const actuallyHandleMessage = useEvent(handleMessage);

    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    // Escalate WebSocket network errors to component errors which crash the UI.
    // Some WebSocket errors are transient and ok to ignore. Like temporarily
    // losing internet. We do not throw these errors.
    if (errorState.hasError) throw errorState.error;

    // Connect our WebSocket only when the hook tells us to connect and the
    // document is visible.
    const actuallyShouldConnect = shouldConnect && isDocumentVisible;

    useEffect(() => {
        setIsConnected(false);

        if (!actuallyShouldConnect) return;

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
    }, [actuallyHandleMessage, actuallyShouldConnect, client]);

    // Watch whether the document is visible. We immediately update our state when
    // the document is made visible but we wait 5s before updating our state when
    // the document is hidden. In case the user temporarily looked at another
    // screen and then returned.
    useEffect(() => {
        setIsDocumentVisible(document.visibilityState === "visible");

        let delayedUpdateTimeout: Timeout | null = null;

        const handleVisibilityChange = () => {
            delayedUpdateTimeout?.clear();
            delayedUpdateTimeout = null;

            if (document.visibilityState === "visible") {
                setIsDocumentVisible(true);
            } else {
                delayedUpdateTimeout = createTimeout(() => {
                    setIsDocumentVisible(false);
                }, 1000 * 5);
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, []);

    const sendMessage = useCallback(
        (message: MessageFromClient) => client.sendMessage(message),
        [client],
    );

    return {
        isConnected,
        sendMessage,
        toggleShouldConnect: useCallback(
            () => setShouldConnect(shouldConnect => !shouldConnect),
            [],
        ),
    };
}
