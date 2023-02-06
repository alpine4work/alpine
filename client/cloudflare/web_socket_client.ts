import {AppContext} from "~/client/context/app_context";
import {webSocketExpirationTimeoutMs} from "~/shared/cloudflare/web_socket_expiration_timeout_ms";
import {
    WebSocketMessageFromClient,
    WebSocketMessageFromServer,
    createWebSocketMessageFromClientSchema,
    createWebSocketMessageFromServerSchema,
} from "~/shared/cloudflare/web_socket_schema";
import {InternalError, UnavailableError, UnknownError} from "~/shared/error/error";
import {createInterval} from "~/shared/helpers/async/interval";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {EventEmitter} from "~/shared/helpers/control/event_emitter";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {quote} from "~/shared/helpers/string/quote";
import {DistributiveOmit} from "~/shared/helpers/types/distributive_omit";
import {generateId} from "~/shared/id/id";
import {WebSocketMessageId} from "~/shared/id/types/id_types";
import {Schema, SchemaDeserializationError, UnionSchema} from "~/shared/schema/schema";

const reconnectTimeoutBaseMs = 1200;
const maxReconnectTimeoutMs = 2500;
const reconnectAttemptsBeforeError = 20;

type WebsocketClientState =
    | {
          readonly type: "disconnected";
          readonly socket?: never;
          readonly pendingSerializedMessages: Array<string>;
      }
    | {
          readonly type: "connecting";
          readonly socket: WebSocket;
          readonly pendingSerializedMessages: Array<string>;
      }
    | {
          readonly type: "connected";
          readonly socket: WebSocket;
          readonly pendingSerializedMessages?: never;
      };

/**
 * A helper for communicating over WebSockets. See `WebSocketServer` for the
 * server side of this helper.
 *
 * Features:
 *
 * - Type safe messages using our schema framework.
 * - Automatic reconnection if the socket disconnects.
 * - Automatic heart beating so the server knows our WebSocket is still alive
 *   and we know our server is still alive.
 * - Resolves URL by replacing the `http://` protocol with `ws://` or
 *   automatically adding the domain name if you use an absolute path like
 *   `/hello/world`.
 *
 * We don't automatically close the WebSocket connection when the user
 * navigates away from the browser tab. That is implemented in
 * `useWebSocket()`.
 */
export class WebSocketClient<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
> {
    private readonly _context: AppContext;
    private readonly _messageFromClientSchema: Schema<
        WebSocketMessageFromClient<MessageFromClient>
    >;
    private readonly _messageFromServerSchema: Schema<
        WebSocketMessageFromServer<MessageFromServer>
    >;
    private readonly _url: string;
    private _shouldConnect = false;
    private _state: WebsocketClientState = {type: "disconnected", pendingSerializedMessages: []};
    private readonly _connectEvent = new EventEmitter();
    private readonly _disconnectEvent = new EventEmitter<Error | null>();
    private readonly _messageEvent = new EventEmitter<MessageFromServer>();
    private _unsuccessfulReconnects = 0;
    private _lastMessageReceived = Date.now();
    private readonly _acknowledgementPromiseResolverByMessageId = new Map<
        WebSocketMessageId,
        PromiseResolver<void>
    >();

    constructor(
        context: AppContext,
        // NOTE(calebmer): Force schemas to be union schemas so the protocol can evolve
        // in the future.
        messageFromClientSchema: UnionSchema<MessageFromClient>,
        messageFromServerSchema: UnionSchema<MessageFromServer>,
        url: string,
    ) {
        this._context = context;
        this._messageFromClientSchema =
            createWebSocketMessageFromClientSchema(messageFromClientSchema);
        this._messageFromServerSchema =
            createWebSocketMessageFromServerSchema(messageFromServerSchema);
        this._url = url;
    }

    /**
     * Connect to the WebSocket.
     *
     * If the socket unexpectedly disconnects then we will automatically reconnect.
     */
    public connect() {
        assert(!this._shouldConnect);
        this._shouldConnect = true;
        this._setupConnection();
    }

    /**
     * Disconnects from the WebSocket.
     */
    public disconnect() {
        assert(this._shouldConnect);
        this._shouldConnect = false;
        const socket = this._state.socket;
        this._state = {
            type: "disconnected",
            pendingSerializedMessages: this._state.pendingSerializedMessages ?? [],
        };
        if (socket) {
            socket.close();
            this._disconnectEvent.emit(null);
        }
    }

    /**
     * Listen to when the WebSocket client successfully connects to the server.
     *
     * Should be fired after you call `connect()`. If the socket disconnects and
     * then reconnects it will be fired when the socket successfully reconnects.
     */
    public subscribeToConnect(listener: () => void): () => void {
        return this._connectEvent.subscribe(listener);
    }

    /**
     * Listen to when the WebSocket disconnects after connecting to the server.
     *
     * Will be fired after you call `disconnect()`. If the socket disconnects
     * unexpectedly due to the server closing or temporary loss of internet then we
     * will fire this event.
     *
     * We may fire a disconnect event without firing a connect event! This happens
     * when connecting to a WebSocket fails.
     */
    public subscribeToDisconnect(listener: (error: Error | null) => void): () => void {
        return this._disconnectEvent.subscribe(listener);
    }

    /**
     * Send a message through the socket.
     *
     * If the socket is not currently connected then we queue messages to send once
     * the socket connects.
     */
    public sendMessage(message: MessageFromClient): Promise<void> {
        return this._context.tracer.withSpan("Send WebSocket message", async (context, span) => {
            const messageId = generateId<WebSocketMessageId>();

            span.addData({webSocket: {messageType: message.type}});

            const serializedMessage = this._messageFromClientSchema.serialize({
                type: "Message",
                messageId,
                message,
                tracerContext: span.getPropagationContext(),
            });

            if (this._state.type === "connected") {
                this._state.socket.send(JSON.stringify(serializedMessage));
            } else {
                this._state.pendingSerializedMessages.push(JSON.stringify(serializedMessage));
            }

            const promiseResolver = createPromiseResolver();
            this._acknowledgementPromiseResolverByMessageId.set(messageId, promiseResolver);
            return promiseResolver.promise;
        });
    }

    /**
     * Listen to messages received from the socket.
     *
     * Will only fire when the socket is connected.
     */
    public subscribeToMessage(handler: (message: MessageFromServer) => void): () => void {
        return this._messageEvent.subscribe(handler);
    }

    private _getResolvedUrl() {
        let url = this._url;

        // If this is an absolute URL, add our current domain's origin. This will
        // only work in the browser.
        if (url.startsWith("/")) url = `${new URL(window.location.href).origin}${url}`;

        // Switch HTTP protocol to WS protocol.
        if (url.startsWith("http://")) url = `ws://${url.slice("http://".length)}`;
        if (url.startsWith("https://")) url = `wss://${url.slice("https://".length)}`;

        return url;
    }

    private _setupConnection() {
        assert(this._state.type === "disconnected");

        const socket = new WebSocket(this._getResolvedUrl());
        this._state = {
            type: "connecting",
            socket,
            pendingSerializedMessages: this._state.pendingSerializedMessages ?? [],
        };

        let pingTimeout: Timeout | undefined;
        let pongPromiseResolver: PromiseResolver<void> | null = null;

        const sendPing = () => {
            if (this._state.type === "connected" && this._state.socket === socket) {
                if (pongPromiseResolver === null) pongPromiseResolver = createPromiseResolver();
                sendMessage({type: "Ping"}, pongPromiseResolver);
            }
        };

        const checkConnectionInterval = createInterval(() => {
            // Ignore events after we detach this WebSocket.
            if (this._state.socket !== socket) {
                checkConnectionInterval.clear();
                return;
            }

            assert(this._state.type === "connecting" || this._state.type === "connected");
            assert(this._state.socket === socket);

            if (webSocketExpirationTimeoutMs < Date.now() - this._lastMessageReceived) {
                socket.close();
            }
        }, webSocketExpirationTimeoutMs / 2);

        socket.addEventListener("open", () => {
            // Ignore events after we detach this WebSocket.
            if (this._state.socket !== socket) return;

            assert(this._state.type === "connecting");

            this._lastMessageReceived = Date.now();
            this._unsuccessfulReconnects = 0;

            const pendingSerializedMessages = this._state.pendingSerializedMessages;
            this._state = {type: "connected", socket};

            for (const message of pendingSerializedMessages) {
                socket.send(message);
            }

            this._connectEvent.emit();
            pingTimeout = createTimeout(sendPing, webSocketExpirationTimeoutMs / 2);
        });

        socket.addEventListener("close", event => {
            // When the WebSocket closes, reject our ping promise resolver since we won't
            // be getting a pong from our new connection.
            pongPromiseResolver?.reject(
                new UnavailableError("WebSocket closed before receiving pong"),
            );
            pongPromiseResolver = null;

            // When the WebSocket closes, reject all messages that haven't been
            // acknowledged since we will not be receiving an acknowledgement for them. We
            // do not resubmit messages when reopening the WebSocket.
            for (const promiseResolver of this._acknowledgementPromiseResolverByMessageId.values()) {
                promiseResolver.reject(
                    new UnavailableError("WebSocket closed before acknowledging message"),
                );
            }
            this._acknowledgementPromiseResolverByMessageId.clear();

            // Ignore events after we detach this WebSocket.
            if (this._state.socket !== socket) return;

            assert(this._state.type === "connecting" || this._state.type === "connected");

            const isGracefullyWaitingForReconnect =
                this._shouldConnect && this._unsuccessfulReconnects < reconnectAttemptsBeforeError;

            // From reading the spec, it looks like the `error` event is only fired before
            // a `close` event. But the `close` event has more interesting information
            // about the error. So we don't have a listener for `error`, just `close`.
            // https://websockets.spec.whatwg.org/#dom-websocket-onerror
            const error =
                (event.code !== 1000 || !event.wasClean) &&
                // Try to reconnect for a short period before showing an error.
                !isGracefullyWaitingForReconnect
                    ? new UnknownError(
                          `WebSocket closed unexpectedly with code ${event.code}${
                              event.reason ? quote`and reason ${event.reason}` : ""
                          }${!event.wasClean ? " (did not exit cleanly)" : ""}`,
                      )
                    : null;

            const wasConnected = this._state.type === "connected";
            this._state = {
                type: "disconnected",
                pendingSerializedMessages: this._state.pendingSerializedMessages ?? [],
            };
            pingTimeout?.clear();
            checkConnectionInterval.clear();
            this._disconnectEvent.emit(error);

            if (this._shouldConnect) {
                if (!wasConnected) this._unsuccessfulReconnects++;

                const timeoutMs = Math.min(
                    maxReconnectTimeoutMs,
                    Math.log10(this._unsuccessfulReconnects + 1) * reconnectTimeoutBaseMs,
                );

                setTimeout(() => {
                    // We may not be disconnected anymore if someone called `connect()`.
                    if (this._state.type !== "disconnected") return;

                    this._setupConnection();
                }, timeoutMs);
            }
        });

        socket.addEventListener("message", event => {
            // Ignore events after we detach this WebSocket.
            if (this._state.socket !== socket) return;

            this._lastMessageReceived = Date.now();
            this._unsuccessfulReconnects = 0;

            let message: WebSocketMessageFromServer<MessageFromServer>;
            try {
                const serializedMessage = JSON.parse(event.data);
                message = this._messageFromServerSchema.deserialize(serializedMessage);
            } catch (error) {
                // Reclassify deserialization errors as internal errors if we can't deserialize
                // the data coming from our WebSocket.
                if (error instanceof SchemaDeserializationError)
                    throw new InternalError(error.message, {cause: error});

                throw error;
            }

            switch (message.type) {
                case "Message": {
                    this._messageEvent.emit(message.message);
                    break;
                }
                case "AcknowledgeMessage": {
                    const promiseResolver = this._acknowledgementPromiseResolverByMessageId.get(
                        message.messageId,
                    );
                    if (promiseResolver) {
                        this._acknowledgementPromiseResolverByMessageId.delete(message.messageId);

                        if (message.result.ok) {
                            promiseResolver.resolve();
                        } else {
                            promiseResolver.reject(message.result.error);
                        }
                    }
                    break;
                }
                case "Ping": {
                    const promiseResolver = createPromiseResolver();
                    sendMessage({type: "Pong"}, promiseResolver);
                    promiseResolver.resolve();
                    break;
                }
                case "Pong": {
                    pingTimeout?.clear();
                    pingTimeout = createTimeout(sendPing, webSocketExpirationTimeoutMs / 2);

                    pongPromiseResolver?.resolve();
                    pongPromiseResolver = null;
                    break;
                }
                default:
                    throw exhaustive(message);
            }
        });

        const sendMessage = (
            message: DistributiveOmit<
                WebSocketMessageFromClient<MessageFromClient>,
                "tracerContext"
            >,
            promiseResolver: PromiseResolver<void>,
        ) => {
            void this._context.tracer.withSpan("Send WebSocket message", async (context, span) => {
                span.addData({
                    webSocket: {
                        messageType:
                            message.type === "Message" ? message.message.type : message.type,
                    },
                });

                const serializedMessage = this._messageFromClientSchema.serialize({
                    ...message,
                    tracerContext: span.getPropagationContext(),
                });
                socket.send(JSON.stringify(serializedMessage));

                return promiseResolver.promise;
            });
        };
    }
}
