import {Memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {WebSocketClient} from "~/client/cloudflare/web_socket_client";
import {useAppContext} from "~/client/context/app_context";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useStore} from "~/client/helpers/store/use_store";
import {InternalError} from "~/shared/error/error";
import {noop} from "~/shared/helpers/control/noop";
import {UnionSchema} from "~/shared/schema/schema";

/**
 * React hook for connecting to a WebSocket using our `WebSocketClient`
 * abstraction.
 *
 * Features:
 *
 * - Automatically attempts to reconnect the WebSocket when it closes
 *   unexpectedly.
 * - Automatically disconnects the WebSocket when the user hides the page.
 * - Type safe messages using our schema framework.
 * - Automatic heart beating so the server knows our WebSocket is still alive
 *   and we know our server is still alive.
 * - Resolves URL by replacing the `http://` protocol with `ws://` or
 *   automatically adding the domain name if you use an absolute path like
 *   `/hello/world`.
 */
export function useWebSocket<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
>(
    messageFromClientSchema: UnionSchema<MessageFromClient>,
    messageFromServerSchema: UnionSchema<MessageFromServer>,
    url: string | null,
    handleMessage?: (message: MessageFromServer) => void,
): {
    isConnected: boolean;
    sendMessage: Memo<(message: MessageFromClient) => Promise<void>>;
    subscribeToMessages: Memo<(subscriber: (message: MessageFromServer) => void) => () => void>;
    toggleShouldConnect: () => void;
} {
    const context = useAppContext();
    const contextRef = useRef(context);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
    });

    const client = useMemo(() => {
        if (!url) return null;

        return new WebSocketClient(
            () => contextRef.current,
            messageFromClientSchema,
            messageFromServerSchema,
            url,
        );
    }, [messageFromClientSchema, messageFromServerSchema, url]);

    const clientState = useStore(client?.state ?? null);

    // TODO(calebmer): This should probably be an interrupting error modal with a
    // retry button instead of a component crash.
    if (clientState?.hasError) throw clientState.error;

    const [shouldConnect, setShouldConnect] = useState(true);

    useEffect(() => {
        if (!client || !shouldConnect) return;

        client.connect();
        return () => client.disconnect();
    }, [client, shouldConnect]);

    const toggleShouldConnect = useCallback(() => {
        setShouldConnect(shouldConnect => !shouldConnect);
    }, []);

    // Subscribe to any messages coming from our client.
    const actuallyHandleMessage = useEvent(handleMessage);
    useEffect(() => {
        return client?.subscribeToMessages(actuallyHandleMessage);
    }, [actuallyHandleMessage, client]);

    return {
        isConnected: clientState?.isConnected ?? false,
        sendMessage: useCallback(
            message => {
                if (!client) {
                    throw new InternalError(
                        "Can't send message when passing null as the URL to `useWebSocket()`",
                    );
                }
                return client.sendMessage(message);
            },
            [client],
        ),
        subscribeToMessages: useCallback(
            subscriber => client?.subscribeToMessages(subscriber) ?? noop,
            [client],
        ),
        toggleShouldConnect,
    };
}
