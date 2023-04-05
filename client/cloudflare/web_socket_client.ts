import {WebSocketClientConnection} from "~/client/cloudflare/web_socket_client_connection";
import {AppContext} from "~/client/context/app_context";
import {ValueStore} from "~/client/helpers/store/value_store";
import {InternalError} from "~/shared/error/error";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {UnionSchema} from "~/shared/schema/schema";

const reconnectTimeoutBaseMs = 1200;
const maxReconnectTimeoutMs = 2500;
const reconnectAttemptsBeforeError = 20;

type WebSocketClientDisconnectTransition = "Disconnected" | "DocumentNotVisible";

type WebSocketClientInternalState<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
> =
    | {
          readonly type: "Connecting";
          readonly pendingMessages: Array<{
              readonly message: MessageFromClient;
              readonly promiseResolver: PromiseResolver<void>;
          }>;
          readonly disconnect: (transition: WebSocketClientDisconnectTransition) => void;
      }
    | {
          readonly type: "Connected";
          readonly connection: WebSocketClientConnection<MessageFromClient, MessageFromServer>;
          readonly disconnect: (transition: WebSocketClientDisconnectTransition) => void;
      }
    | {
          readonly type: "WaitingToReconnect";
          readonly pendingMessages: Array<{
              readonly message: MessageFromClient;
              readonly promiseResolver: PromiseResolver<void>;
          }>;
          readonly disconnect: (transition: WebSocketClientDisconnectTransition) => void;
      }
    | {
          readonly type: "Error";
          readonly error: unknown;
          readonly pendingMessages: Array<{
              readonly message: MessageFromClient;
              readonly promiseResolver: PromiseResolver<void>;
          }>;
          readonly disconnect: (transition: WebSocketClientDisconnectTransition) => void;
      }
    | {
          readonly type: "DocumentNotVisible";
          readonly pendingMessages: Array<{
              readonly message: MessageFromClient;
              readonly promiseResolver: PromiseResolver<void>;
          }>;
          readonly disconnect: (transition: WebSocketClientDisconnectTransition) => void;
      }
    | {
          readonly type: "Disconnected";
          readonly pendingMessages: Array<{
              readonly message: MessageFromClient;
              readonly promiseResolver: PromiseResolver<void>;
          }>;
      };

export type WebSocketClientState =
    | {
          readonly hasError: false;
          readonly isConnecting: false;
          readonly isConnected: false;
          readonly isDisconnected: boolean;
      }
    | {
          readonly hasError: false;
          readonly isConnecting: true;
          readonly isConnected: false;
          readonly isDisconnected: false;
      }
    | {
          readonly hasError: false;
          readonly isConnecting: false;
          readonly isConnected: true;
          readonly isDisconnected: false;
      }
    | {
          readonly hasError: true;
          readonly isConnecting: false;
          readonly isConnected: false;
          readonly isDisconnected: false;
          readonly error: unknown;
      };

/**
 * A helper for communicating over WebSockets. See `WebSocketServer` for the
 * server side of this helper.
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
 *
 * Manages underlying `WebSocketClientConnection` classes. This class may have
 * many underlying connections over the course of its life.
 */
export class WebSocketClient<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
> {
    private readonly _getContext: () => AppContext;
    private readonly _messageFromClientSchema: UnionSchema<MessageFromClient>;
    private readonly _messageFromServerSchema: UnionSchema<MessageFromServer>;
    private readonly _url: string;

    private readonly _state = new ValueStore<
        WebSocketClientInternalState<MessageFromClient, MessageFromServer>
    >({
        type: "Disconnected",
        pendingMessages: [],
    });

    constructor(
        getContext: () => AppContext,
        // NOTE(calebmer): Force schemas to be union schemas so the protocol can evolve
        // in the future.
        messageFromClientSchema: UnionSchema<MessageFromClient>,
        messageFromServerSchema: UnionSchema<MessageFromServer>,
        url: string,
    ) {
        this._getContext = getContext;
        this._messageFromClientSchema = messageFromClientSchema;
        this._messageFromServerSchema = messageFromServerSchema;
        this._url = url;
    }

    /**
     * Get the current state of the WebSocket and subscribe to updates.
     */
    public readonly state = this._state.map((state): WebSocketClientState => {
        switch (state.type) {
            case "Connecting":
            case "WaitingToReconnect": {
                return {
                    hasError: false,
                    isConnecting: true,
                    isConnected: false,
                    isDisconnected: false,
                };
            }
            case "Connected": {
                return {
                    hasError: false,
                    isConnecting: false,
                    isConnected: true,
                    isDisconnected: false,
                };
            }
            case "Error": {
                return {
                    hasError: true,
                    isConnecting: false,
                    isConnected: false,
                    isDisconnected: false,
                    error: state.error,
                };
            }
            case "DocumentNotVisible": {
                return {
                    hasError: false,
                    isConnecting: false,
                    isConnected: false,
                    isDisconnected: false,
                };
            }
            case "Disconnected": {
                return {
                    hasError: false,
                    isConnecting: false,
                    isConnected: false,
                    isDisconnected: true,
                };
            }
            default:
                throw exhaustive(state);
        }
    });

    /**
     * Connect to the WebSocket.
     *
     * If we fail to connect to the WebSocket or the WebSocket closes
     * unexpectedly then we will try to reconnect. You can observe this by
     * subscribing to state.
     *
     * Will throw an error if the WebSocket is not disconnected. Which you can
     * check with `isDisconnected` in state.
     */
    public connect(): void {
        const previousState = this._state.getSnapshot();
        assert(previousState.type === "Disconnected", "WebSocket is already connected");
        let pendingMessages = previousState.pendingMessages;

        let reconnectAttempts = 0;

        const connect = () => {
            const connection = new WebSocketClientConnection(
                this._getContext,
                this._messageFromClientSchema,
                this._messageFromServerSchema,
                this._url,
            );

            let wasDisconnected = false;

            const disconnect = (transition: WebSocketClientDisconnectTransition) => {
                wasDisconnected = true;
                void connection.close();
                actuallyDisconnect(transition);
            };

            this._state.set({
                type: "Connecting",
                pendingMessages,
                disconnect,
            });

            connection.waitForOpen().then(
                () => {
                    if (wasDisconnected) return;

                    reconnectAttempts = 0;

                    this._state.set({
                        type: "Connected",
                        connection,
                        disconnect,
                    });

                    // Send any pending messages that were queued when we didn't have a connection.
                    const newPendingMessages = pendingMessages;
                    pendingMessages = [];
                    for (const {message, promiseResolver} of newPendingMessages) {
                        connection
                            .sendMessage(message)
                            .then(promiseResolver.resolve, promiseResolver.reject);
                    }
                },
                error => {
                    // Ignore errors when waiting for the client to open. Any relevant errors will
                    // be reported by `client.waitForClose()` with a better description.
                },
            );

            connection.waitForClose().then(
                () => {
                    if (wasDisconnected) return;

                    // We should only call `close()` after setting `isCancelled` in our
                    // `disconnect` function.
                    reconnect(
                        new InternalError(
                            "Unexpected call to WebSocket connection `close()` method",
                        ),
                    );
                },
                error => {
                    if (wasDisconnected) return;
                    reconnect(error);
                },
            );
        };

        const reconnect = (error: unknown) => {
            reconnectAttempts++;

            if (reconnectAttempts > reconnectAttemptsBeforeError) {
                this._state.set({
                    type: "Error",
                    error,
                    pendingMessages,
                    disconnect: actuallyDisconnect,
                });
                return;
            }

            const timeoutMs = Math.min(
                maxReconnectTimeoutMs,
                Math.log10(reconnectAttempts) * reconnectTimeoutBaseMs,
            );

            const timeout = createTimeout(connect, timeoutMs);

            this._state.set({
                type: "WaitingToReconnect",
                pendingMessages,
                disconnect: transition => {
                    timeout.clear();
                    actuallyDisconnect(transition);
                },
            });
        };

        let delayedDocumentNotVisibleTimeout: Timeout | null = null;

        const handleDocumentVisibilityChange = () => {
            delayedDocumentNotVisibleTimeout?.clear();
            delayedDocumentNotVisibleTimeout = null;

            if (document.visibilityState === "visible") {
                const state = this._state.getSnapshot();
                if (state.type === "DocumentNotVisible") connect();
            } else {
                delayedDocumentNotVisibleTimeout = createTimeout(() => {
                    const state = this._state.getSnapshot();
                    if (state.type !== "Disconnected") state.disconnect("DocumentNotVisible");
                }, 1000 * 5);
            }
        };

        document.addEventListener("visibilitychange", handleDocumentVisibilityChange);

        const actuallyDisconnect = (transition: WebSocketClientDisconnectTransition) => {
            switch (transition) {
                case "Disconnected": {
                    document.removeEventListener(
                        "visibilitychange",
                        handleDocumentVisibilityChange,
                    );

                    this._state.set({
                        type: "Disconnected",
                        pendingMessages,
                    });
                    break;
                }
                case "DocumentNotVisible": {
                    this._state.set({
                        type: "DocumentNotVisible",
                        pendingMessages,
                        disconnect: actuallyDisconnect,
                    });
                    break;
                }
                default:
                    throw exhaustive(transition);
            }
        };

        if (document.visibilityState === "visible") {
            connect();
        } else {
            this._state.set({
                type: "DocumentNotVisible",
                pendingMessages,
                disconnect: actuallyDisconnect,
            });
        }
    }

    /**
     * Disconnect from the WebSocket.
     *
     * Will throw an error if the WebSocket is already disconnected. Which you can
     * check with `isDisconnected` in state.
     */
    public disconnect(): void {
        const state = this._state.getSnapshot();
        assert(state.type !== "Disconnected", "WebSocket is already disconnected");

        state.disconnect("Disconnected");

        assert(
            this._state.getSnapshot().type === "Disconnected",
            "WebSocket internals should have updated state to `Disconnected`",
        );
    }

    /**
     * Send a message to the WebSocket.
     *
     * If the WebSocket is not connected then we will queue the message to send
     * when it eventually connects.
     */
    public sendMessage(message: MessageFromClient): Promise<void> {
        const state = this._state.getSnapshot();

        switch (state.type) {
            case "Connected":
                return state.connection.sendMessage(message);
            case "Connecting":
            case "WaitingToReconnect":
            case "Error":
            case "DocumentNotVisible":
            case "Disconnected": {
                const promiseResolver = createPromiseResolver();
                state.pendingMessages.push({message, promiseResolver});
                return promiseResolver.promise;
            }
            default:
                throw exhaustive(state);
        }
    }

    /**
     * Subscribe to messages from our WebSocket.
     */
    public subscribeToMessages(listener: (message: MessageFromServer) => void): () => void {
        let unsubscribeFromMessages: (() => void) | null = null;

        const stateListener = () => {
            unsubscribeFromMessages?.();
            unsubscribeFromMessages = null;

            const state = this._state.getSnapshot();

            switch (state.type) {
                case "Connected":
                    unsubscribeFromMessages = state.connection.subscribeToMessages(listener);
                    break;
                case "Connecting":
                case "WaitingToReconnect":
                case "Error":
                case "DocumentNotVisible":
                case "Disconnected":
                    break;
                default:
                    throw exhaustive(state);
            }
        };

        const unsubscribeFromState = this._state.subscribe(stateListener);

        stateListener();

        return () => {
            unsubscribeFromState();
            unsubscribeFromMessages?.();
        };
    }
}
