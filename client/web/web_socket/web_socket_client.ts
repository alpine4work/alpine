import {
    WebSocketClientConnection,
    type WebSocketClientCreateSocket,
} from "~/client/web/web_socket/web_socket_client_connection.js";
import type {Context} from "~/shared/context/context.js";
import type {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {isTransientError} from "~/shared/error/is_transient_error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {ValueStore} from "~/shared/store/value_store.js";
import {TracerServiceName} from "~/shared/tracer/tracer_root.js";
import {
    WebSocketProtocolBase,
    WebSocketProtocolEventType,
    WebSocketProtocolProceduresType,
} from "~/shared/web_socket/web_socket_protocol.js";
import {WebSocketPongMessage} from "~/shared/web_socket/web_socket_schema.js";

const reconnectTimeoutBaseMs = 1200;
const maxReconnectTimeoutMs = 2500;
const reconnectAttemptsBeforeError = 20;
const openHealthyDurationMs = 10000;

type WebSocketClientDisconnectTransition = "Disconnected" | "DocumentNotVisible";

type WebSocketClientContext = Context<{tracer: TracerContextModule}>;

type WebSocketClientInternalState<Protocol extends WebSocketProtocolBase> =
    | {
          readonly type: "Connecting";
          readonly pendingProcedures: Array<{
              readonly name: string;
              readonly input: unknown;
              readonly outputPromiseResolver: PromiseResolver<unknown>;
          }>;
          readonly disconnect: (transition: WebSocketClientDisconnectTransition) => Promise<void>;
      }
    | {
          readonly type: "Connected";
          readonly connection: WebSocketClientConnection<Protocol>;
          readonly disconnect: (transition: WebSocketClientDisconnectTransition) => Promise<void>;
      }
    | {
          readonly type: "WaitingToReconnect";
          readonly pendingProcedures: Array<{
              readonly name: string;
              readonly input: unknown;
              readonly outputPromiseResolver: PromiseResolver<unknown>;
          }>;
          readonly disconnect: (transition: WebSocketClientDisconnectTransition) => Promise<void>;
      }
    | {
          readonly type: "Error";
          readonly error: unknown;
          readonly pendingProcedures: Array<{
              readonly name: string;
              readonly input: unknown;
              readonly outputPromiseResolver: PromiseResolver<unknown>;
          }>;
          readonly disconnect: (transition: WebSocketClientDisconnectTransition) => Promise<void>;
      }
    | {
          readonly type: "DocumentNotVisible";
          readonly pendingProcedures: Array<{
              readonly name: string;
              readonly input: unknown;
              readonly outputPromiseResolver: PromiseResolver<unknown>;
          }>;
          readonly disconnect: (transition: WebSocketClientDisconnectTransition) => Promise<void>;
      }
    | {
          readonly type: "Disconnected";
          readonly pendingProcedures: Array<{
              readonly name: string;
              readonly input: unknown;
              readonly outputPromiseResolver: PromiseResolver<unknown>;
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

export type WebSocketClientProcedures<
    Procedures extends {[name: string]: {input: {}; output: {}}},
> = {
    readonly [Name in keyof Procedures & string]: (
        input: Procedures[Name]["input"],
    ) => Promise<Procedures[Name]["output"]>;
};

export interface WebSocketClientOptions {
    readonly createSocket?: WebSocketClientCreateSocket;
}

export type {WebSocketClientCreateSocket};

/**
 * A helper for communicating over WebSockets. See `WebSocketServer` for the server
 * side of this helper.
 *
 * Features:
 *
 * - Automatically attempts to reconnect the WebSocket when it closes unexpectedly.
 * - Automatically disconnects the WebSocket when the user hides the page.
 * - Type safe messages using our schema framework.
 * - Automatic heart beating so the server knows our WebSocket is still alive and
 *   we know our server is still alive.
 * - Resolves URL by replacing the `http://` protocol with `ws://` or automatically
 *   adding the domain name if you use an absolute path like `/hello/world`.
 *
 * Manages underlying `WebSocketClientConnection` classes. This class may have many
 * underlying connections over the course of its life.
 */
export class WebSocketClient<Protocol extends WebSocketProtocolBase> {
    private readonly _getContext: () => WebSocketClientContext;
    private readonly _serviceName: TracerServiceName;
    private readonly _protocol: Protocol;
    private readonly _url: string;
    private readonly _createSocket: WebSocketClientCreateSocket | undefined;

    private readonly _state = new ValueStore<WebSocketClientInternalState<Protocol>>({
        type: "Disconnected",
        pendingProcedures: [],
    });

    public readonly procedures: WebSocketClientProcedures<
        WebSocketProtocolProceduresType<Protocol>
    >;

    constructor(
        getContext: () => WebSocketClientContext,
        serviceName: TracerServiceName,
        protocol: Protocol,
        url: string,
        options: WebSocketClientOptions = {},
    ) {
        this._getContext = getContext;
        this._serviceName = serviceName;
        this._protocol = protocol;
        this._url = url;
        this._createSocket = options.createSocket;

        this.procedures = mapObjectValues(
            this._protocol.procedureSchemas,
            (procedureSchema, procedureName) => (input: any) =>
                this._executeProcedure(procedureName, input),
        ) as any;
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
     * If we fail to connect to the WebSocket or the WebSocket closes unexpectedly then
     * we will try to reconnect. You can observe this by subscribing to state.
     *
     * Will throw an error if the WebSocket is not disconnected. Which you can check
     * with `isDisconnected` in state.
     */
    public connect(): void {
        let pendingProcedures: Array<{
            readonly name: string;
            readonly input: unknown;
            readonly outputPromiseResolver: PromiseResolver<unknown>;
        }>;

        let reconnectAttempts = 0;

        const connect = () => {
            const connection = new WebSocketClientConnection(
                this._getContext,
                this._serviceName,
                this._protocol,
                this._url,
                this._createSocket,
            );

            let wasDisconnected = false;
            let openHealthyTimeout: Timeout | null;

            const disconnect = (transition: WebSocketClientDisconnectTransition) => {
                wasDisconnected = true;
                openHealthyTimeout?.clear();
                openHealthyTimeout = null;
                const closePromise = connection.close();
                actuallyDisconnect(transition);
                return closePromise;
            };

            this._state.set({
                type: "Connecting",
                pendingProcedures,
                disconnect,
            });

            connection.waitForOpen().then(
                () => {
                    if (wasDisconnected) return;

                    // Once the WebSocket connection has been open for some duration we consider it
                    // healthy and reset reconnection attempts. If the WebSocket continually closes
                    // before we consider it healthy then we treat that as an error. Otherwise we get
                    // into infinite loops of opening and closing WebSockets.
                    openHealthyTimeout = createTimeout(() => {
                        reconnectAttempts = 0;
                    }, openHealthyDurationMs);

                    this._state.set({
                        type: "Connected",
                        connection,
                        disconnect,
                    });

                    // Send any pending messages that were queued when we didn't have a connection.
                    const newPendingProcedures = pendingProcedures;
                    pendingProcedures = [];
                    for (const {name, input, outputPromiseResolver} of newPendingProcedures) {
                        connection
                            .executeProcedure(name, input as any)
                            .then(outputPromiseResolver.resolve, outputPromiseResolver.reject);
                    }
                },
                () => {
                    // Ignore errors when waiting for the client to open. Any relevant errors will be
                    // reported by `client.waitForSoftClose()` with a better description.
                },
            );

            let wasSoftClosed = false;

            // We wait for soft close instead of full close since if the server soft closes our
            // connection (say during a graceful server shutdown) we want to immediately
            // reconnect to a live server.
            connection.waitForSoftClose().then(
                () => {
                    wasSoftClosed = true;

                    if (wasDisconnected) return;

                    openHealthyTimeout?.clear();
                    openHealthyTimeout = null;

                    // We should only call `close()` after setting `isCancelled` in our `disconnect`
                    // function.
                    reconnect(
                        new InternalError(
                            "Unexpected call to WebSocket connection `close()` method",
                        ),
                    );
                },
                error => {
                    if (wasDisconnected) return;

                    openHealthyTimeout?.clear();
                    openHealthyTimeout = null;

                    reconnect(error);
                },
            );

            // Ignore any errors from our close promise. If we close with an error than
            // `waitForSoftClose()` will see that error and attempt to reconnect.
            //
            // If we soft closed but then close later receives an error, that's unexpected and
            // we should log it.
            connection.waitForClose().catch(error => {
                if (wasSoftClosed) {
                    this._getContext()
                        .tracer.getRoot()
                        .logException("WebSocket closed with error after soft close", error);
                }
            });
        };

        const reconnect = (error: unknown) => {
            reconnectAttempts++;

            // If this is a transient error then silently try reconnecting a couple times
            // before showing the user an error.
            if (!isTransientError(error) || reconnectAttempts > reconnectAttemptsBeforeError) {
                this._state.set({
                    type: "Error",
                    error,
                    pendingProcedures,
                    disconnect: transition => {
                        actuallyDisconnect(transition);
                        return Promise.resolve();
                    },
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
                pendingProcedures,
                disconnect: transition => {
                    timeout.clear();
                    actuallyDisconnect(transition);
                    return Promise.resolve();
                },
            });
        };

        let delayedDocumentNotVisibleTimeout: Timeout | null = null;

        const browserDocument = typeof document === "undefined" ? null : document;

        const handleDocumentVisibilityChange = () => {
            if (browserDocument === null) return;
            delayedDocumentNotVisibleTimeout?.clear();
            delayedDocumentNotVisibleTimeout = null;

            if (browserDocument.visibilityState === "visible") {
                const state = this._state.getSnapshot();
                if (state.type === "DocumentNotVisible") connect();
            } else {
                delayedDocumentNotVisibleTimeout = createTimeout(() => {
                    const state = this._state.getSnapshot();
                    if (state.type !== "Disconnected") void state.disconnect("DocumentNotVisible");
                }, 1000 * 5);
            }
        };

        browserDocument?.addEventListener("visibilitychange", handleDocumentVisibilityChange);

        const actuallyDisconnect = (transition: WebSocketClientDisconnectTransition) => {
            switch (transition) {
                case "Disconnected": {
                    browserDocument?.removeEventListener(
                        "visibilitychange",
                        handleDocumentVisibilityChange,
                    );

                    this._state.set({
                        type: "Disconnected",
                        pendingProcedures,
                    });
                    break;
                }
                case "DocumentNotVisible": {
                    this._state.set({
                        type: "DocumentNotVisible",
                        pendingProcedures,
                        disconnect: transition => {
                            actuallyDisconnect(transition);
                            return Promise.resolve();
                        },
                    });
                    break;
                }
                default:
                    throw exhaustive(transition);
            }
        };

        // Actually connect (by calling `connect()`) after defining all the functions we
        // need.
        {
            const previousState = this._state.getSnapshot();
            assert(previousState.type === "Disconnected", "WebSocket is already connected");
            pendingProcedures = previousState.pendingProcedures;

            if (browserDocument === null || browserDocument.visibilityState === "visible") {
                connect();
            } else {
                this._state.set({
                    type: "DocumentNotVisible",
                    pendingProcedures,
                    disconnect: transition => {
                        actuallyDisconnect(transition);
                        return Promise.resolve();
                    },
                });
            }
        }
    }

    /**
     * Disconnect from the WebSocket.
     *
     * Will throw an error if the WebSocket is already disconnected. Which you can
     * check with `isDisconnected` in state.
     *
     * Returns a promise that resolves when the underlying WebSocket actually closes.
     * If we have some previously executed procedures we are waiting on acknowledgments
     * for then the underlying WebSocket won't actually close until we get those
     * acknowledgements.
     *
     * This WebSocket client will synchronously accept no new messages after calling
     * this function. Calling `connect()` will create a new connection even if the
     * original underlying connection hasn't fully closed yet.
     */
    public disconnect(): Promise<void> {
        const state = this._state.getSnapshot();
        assert(state.type !== "Disconnected", "WebSocket is already disconnected");

        const disconnectPromise = state.disconnect("Disconnected");

        assert(
            this._state.getSnapshot().type === "Disconnected",
            "WebSocket internals should have updated state to `Disconnected`",
        );

        return disconnectPromise;
    }

    /**
     * Reconnect the WebSocket. If the WebSocket is currently connected then this
     * closes the old connection and starts a new one. If the WebSocket is not
     * connected then we start a new connection.
     */
    public reconnect() {
        // If we're not disconnected then disconnect...
        if (this._state.getSnapshot().type !== "Disconnected") {
            void this.disconnect();
        }

        this.connect();
    }

    /**
     * Execute a procedure through the socket.
     *
     * If the WebSocket is not connected then we will queue the message to send when it
     * eventually connects.
     */
    private _executeProcedure<
        Name extends keyof WebSocketProtocolProceduresType<Protocol> & string,
    >(
        name: Name,
        input: WebSocketProtocolProceduresType<Protocol>[Name]["input"],
    ): Promise<WebSocketProtocolProceduresType<Protocol>[Name]["output"]> {
        const state = this._state.getSnapshot();

        switch (state.type) {
            case "Connected":
                return state.connection.executeProcedure(name, input);
            case "Connecting":
            case "WaitingToReconnect":
            case "Error":
            case "DocumentNotVisible":
            case "Disconnected": {
                const outputPromiseResolver = createPromiseResolver<unknown>();
                state.pendingProcedures.push({name, input, outputPromiseResolver});
                return outputPromiseResolver.promise as any;
            }
            default:
                throw exhaustive(state);
        }
    }

    /**
     * Subscribe to events from our WebSocket.
     */
    public subscribeToEvents(
        listener: (event: WebSocketProtocolEventType<Protocol>) => void,
    ): () => void {
        let unsubscribeFromEvents: (() => void) | null = null;

        const stateListener = () => {
            unsubscribeFromEvents?.();
            unsubscribeFromEvents = null;

            const state = this._state.getSnapshot();

            switch (state.type) {
                case "Connected":
                    unsubscribeFromEvents = state.connection.subscribeToEvents(listener);
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
            unsubscribeFromEvents?.();
        };
    }

    /**
     * Subscribe to pong messages from our WebSocket.
     */
    public subscribeToPongs(listener: (message: WebSocketPongMessage) => void): () => void {
        let unsubscribeFromEvents: (() => void) | null = null;

        const stateListener = () => {
            unsubscribeFromEvents?.();
            unsubscribeFromEvents = null;

            const state = this._state.getSnapshot();

            switch (state.type) {
                case "Connected":
                    unsubscribeFromEvents = state.connection.subscribeToPongs(listener);
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
            unsubscribeFromEvents?.();
        };
    }
}
