import {Memo, useCallback, useEffect, useRef, useState} from "react";
import {WebSocketClientInternal} from "~/client/cloudflare/internal/web_socket_client_internal";
import {useAppContext} from "~/client/context/app_context";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {InternalError} from "~/shared/error/error";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {noop} from "~/shared/helpers/control/noop";
import {UnionSchema} from "~/shared/schema/schema";

const reconnectTimeoutBaseMs = 1200;
const maxReconnectTimeoutMs = 2500;
const reconnectAttemptsBeforeError = 20;

/**
 * React hook for connecting to a WebSocket using our `WebSocketClient`
 * abstraction.
 *
 * Features:
 *
 * - Automatically attempts to reconnect the WebSocket when it closes
 *   unexpectedly.
 * - Automatically disconnects the WebSocket when the user hides the page.
 */
export function useWebSocket<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
>(
    messageFromClientSchema: UnionSchema<MessageFromClient>,
    messageFromServerSchema: UnionSchema<MessageFromServer>,
    maybeUrl: string | null,
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

    const [isDocumentVisible, setIsDocumentVisible] = useState(
        // Will be different on client and server but shouldn't change what's in the
        // DOM since this state only gets used in effects.
        typeof document !== "undefined" && document.visibilityState === "visible",
    );

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

    const [_clientState, setClientState] = useState<
        | {
              url: string;
              client: WebSocketClientInternal<MessageFromClient, MessageFromServer>;
              isConnected: boolean;
              hasError: false;
          }
        | {
              url: string;
              hasError: true;
              error: unknown;
          }
        | null
    >(null);

    // If the `url` changes our effect will reset our client state. Make sure in
    // the render function we do the same.
    const clientState = !_clientState || _clientState.url === maybeUrl ? _clientState : null;

    const pendingMessagesRef = useRef<
        Array<{message: MessageFromClient; promiseResolver: PromiseResolver<void>}>
    >([]);

    // Escalate WebSocket network errors to component errors which crash the UI.
    // Some WebSocket errors are transient and ok to ignore. Like temporarily
    // losing internet. We do not throw these errors.
    if (clientState?.hasError) throw clientState.error;

    const [shouldConnect, setShouldConnect] = useState(true);

    // Connect our WebSocket only when the hook tells us to connect and the
    // document is visible.
    const actuallyShouldConnect = shouldConnect && isDocumentVisible;

    // Manage the `WebSocketClient` lifecycle. Will connect when the page is
    // visible, disconnect when the page is hidden, and attempt to reconnect the
    // client on network failures.
    useEffect(() => {
        if (!actuallyShouldConnect || maybeUrl === null) {
            setClientState(null);
            return;
        }

        const url = maybeUrl;
        let reconnectAttempts = 0;
        let isCancelled = false;

        let client: WebSocketClientInternal<MessageFromClient, MessageFromServer>;
        connect();

        function connect() {
            client = new WebSocketClientInternal(
                () => contextRef.current,
                messageFromClientSchema,
                messageFromServerSchema,
                url,
            );

            setClientState({
                url,
                client,
                isConnected: false,
                hasError: false,
            });

            // Send any pending messages that were queued when client state was set to null.
            const pendingMessages = pendingMessagesRef.current;
            pendingMessagesRef.current = [];
            for (const {message, promiseResolver} of pendingMessages) {
                client.sendMessage(message).then(promiseResolver.resolve, promiseResolver.reject);
            }

            client.waitForOpen().then(
                () => {
                    if (isCancelled) return;

                    reconnectAttempts = 0;

                    setClientState({
                        url,
                        client,
                        isConnected: true,
                        hasError: false,
                    });
                },
                error => {
                    // Ignore errors when waiting for the client to open. Any relevant errors will
                    // be reported by `client.waitForClose()` with a better description.
                },
            );

            client.waitForClose().then(
                () => {
                    if (isCancelled) return;
                    reconnect(
                        new InternalError(
                            "WebSocket `close()` method called outside of effect lifecycle",
                        ),
                    );
                },
                error => {
                    if (isCancelled) return;
                    reconnect(error);
                },
            );
        }

        function reconnect(error: unknown) {
            reconnectAttempts++;

            if (reconnectAttempts > reconnectAttemptsBeforeError) {
                setClientState({
                    url,
                    hasError: true,
                    error,
                });
                return;
            }

            setClientState(null);

            const timeoutMs = Math.min(
                maxReconnectTimeoutMs,
                Math.log10(reconnectAttempts) * reconnectTimeoutBaseMs,
            );

            setTimeout(() => {
                if (isCancelled) return;
                connect();
            }, timeoutMs);
        }

        return () => {
            isCancelled = true;
            void client.close();
        };

        // IMPORTANT: Be careful about what goes into this dependency array! Whenever
        // one of these values changes we will disconnect and reconnect our WebSocket.
    }, [actuallyShouldConnect, maybeUrl, messageFromClientSchema, messageFromServerSchema]);

    // Subscribe to any messages coming from our client.
    const actuallyHandleMessage = useEvent(handleMessage);
    useEffect(() => {
        return clientState?.client.subscribeToMessage(actuallyHandleMessage);
    }, [actuallyHandleMessage, clientState?.client]);

    return {
        isConnected: clientState?.isConnected ?? false,
        sendMessage: useCallback(
            message => {
                if (!clientState?.client) {
                    const promiseResolver = createPromiseResolver();
                    pendingMessagesRef.current.push({message, promiseResolver});
                    return promiseResolver.promise;
                }
                return clientState.client.sendMessage(message);
            },
            [clientState?.client],
        ),
        subscribeToMessages: useCallback(
            subscriber => clientState?.client.subscribeToMessage(subscriber) ?? noop,
            [clientState?.client],
        ),
        toggleShouldConnect: useCallback(
            () => setShouldConnect(shouldConnect => !shouldConnect),
            [],
        ),
    };
}
