import {AppContext} from "~/client/context/app_context";
import {webSocketExpirationTimeoutMs} from "~/shared/cloudflare/web_socket_expiration_timeout_ms";
import {
    WebSocketMessageFromClient,
    WebSocketMessageFromServer,
    createWebSocketMessageFromClientSchema,
    createWebSocketMessageFromServerSchema,
} from "~/shared/cloudflare/web_socket_schema";
import {UnavailableError} from "~/shared/error/error";
import {InternalError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {createInterval} from "~/shared/helpers/async/interval";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {EventEmitter} from "~/shared/helpers/control/event_emitter";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {quote} from "~/shared/helpers/string/quote";
import {generateId} from "~/shared/id/id";
import {WebSocketMessageId} from "~/shared/id/types/id_types";
import {Schema, SchemaDeserializationError, UnionSchema} from "~/shared/schema/schema";

type WebsocketClientState =
    | {
          readonly type: "Connecting";
          readonly pendingSerializedMessages: Array<string>;
      }
    | {
          readonly type: "Open";
      }
    | {
          readonly type: "SoftClosedWhileWaitingForMessageAcknowledgments";
      }
    | {
          readonly type: "Closed";
      };

const sendWebSocketMessageSpanName = "Sent WebSocket message";

function resolveWebSocketUrl(url: string) {
    // If this is an absolute URL, add our current domain's origin. This will
    // only work in the browser.
    if (url.startsWith("/")) url = `${new URL(window.location.href).origin}${url}`;

    // Switch HTTP protocol to WS protocol.
    if (url.startsWith("http://")) url = `ws://${url.slice("http://".length)}`;
    if (url.startsWith("https://")) url = `wss://${url.slice("https://".length)}`;

    return url;
}

/**
 * A helper for communicating over WebSockets. See `WebSocketServer` for the
 * server side of this helper.
 *
 * Features:
 *
 * - Type safe messages using our schema framework.
 * - Automatic heart beating so the server knows our WebSocket is still alive
 *   and we know our server is still alive.
 * - Resolves URL by replacing the `http://` protocol with `ws://` or
 *   automatically adding the domain name if you use an absolute path like
 *   `/hello/world`.
 *
 * You probably shouldn't use this class directly and instead should be using
 * `useWebSocket()` which adds a couple other essential features. Like trying to
 * reconnect after a network interruption and closing the connection when the
 * browser tab is hidden.
 */
export class WebSocketClient<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
> {
    private readonly _getContext: () => AppContext;
    private readonly _messageFromClientSchema: Schema<
        WebSocketMessageFromClient<MessageFromClient>
    >;
    private readonly _messageFromServerSchema: Schema<
        WebSocketMessageFromServer<MessageFromServer>
    >;
    private readonly _messageEvent = new EventEmitter<MessageFromServer>();
    private readonly _openPromiseResolver = createPromiseResolver();
    private readonly _closePromiseResolver = createPromiseResolver();
    private readonly _socket: WebSocket;
    private _state: WebsocketClientState;
    private _lastMessageReceived = Date.now();
    private readonly _acknowledgementPromiseResolverByMessageId = new Map<
        WebSocketMessageId,
        PromiseResolver<void>
    >();

    constructor(
        getContext: () => AppContext,
        // NOTE(calebmer): Force schemas to be union schemas so the protocol can evolve
        // in the future.
        messageFromClientSchema: UnionSchema<MessageFromClient>,
        messageFromServerSchema: UnionSchema<MessageFromServer>,
        url: string,
    ) {
        this._getContext = getContext;
        this._messageFromClientSchema =
            createWebSocketMessageFromClientSchema(messageFromClientSchema);
        this._messageFromServerSchema =
            createWebSocketMessageFromServerSchema(messageFromServerSchema);

        this._state = {type: "Connecting", pendingSerializedMessages: []};

        this._socket = new WebSocket(resolveWebSocketUrl(url));

        let pingTimeout: Timeout | undefined;
        let pongPromiseResolver: PromiseResolver<void> | undefined;

        const sendPing = () => {
            if (this._state.type !== "Open") return;

            void this._getContext().tracer.withSpan(
                sendWebSocketMessageSpanName,
                async (context, span) => {
                    span.addData({webSocket: {messageType: "Ping"}});

                    if (!pongPromiseResolver) pongPromiseResolver = createPromiseResolver();

                    const serializedMessage = this._messageFromClientSchema.serialize({
                        type: "Ping",
                        tracerContext: span.getPropagationContext(),
                    });
                    this._socket.send(JSON.stringify(serializedMessage));

                    return pongPromiseResolver.promise;
                },
            );
        };

        const checkConnectionInterval = createInterval(() => {
            if (this._state.type !== "Connecting" && this._state.type !== "Open") {
                checkConnectionInterval.clear();
                return;
            }

            if (webSocketExpirationTimeoutMs < Date.now() - this._lastMessageReceived) {
                this._socket.close();
            }
        }, webSocketExpirationTimeoutMs / 2);

        this._socket.addEventListener("open", () => {
            assert(this._state.type === "Connecting");
            this._lastMessageReceived = Date.now();

            const pendingSerializedMessages = this._state.pendingSerializedMessages;
            this._state = {type: "Open"};

            for (const message of pendingSerializedMessages) {
                this._socket.send(message);
            }

            pingTimeout = createTimeout(sendPing, webSocketExpirationTimeoutMs / 2);

            this._openPromiseResolver.resolve();
        });

        this._socket.addEventListener("close", event => {
            // If the user called `close()` then we consider the close to be expected and we
            // won't fire an error.
            const wasCloseExpected = this._state.type === "Closed";

            this._state = {type: "Closed"};
            pingTimeout?.clear();
            checkConnectionInterval.clear();

            // When the WebSocket closes, reject our ping promise resolver since we won't
            // be getting a pong from our new connection.
            pongPromiseResolver?.reject(
                new UnavailableError("WebSocket closed before receiving pong"),
            );
            pongPromiseResolver = undefined;

            // When the WebSocket closes, reject all messages that haven't been
            // acknowledged since we will not be receiving an acknowledgement for them. We
            // do not resubmit messages when reopening the WebSocket.
            for (const promiseResolver of this._acknowledgementPromiseResolverByMessageId.values()) {
                promiseResolver.reject(
                    new UnavailableError("WebSocket closed before acknowledging message", {
                        displayMessage: errorDisplayMessage`Your connection to our servers was ended unexpectedly. Please try again.`,
                    }),
                );
            }
            this._acknowledgementPromiseResolverByMessageId.clear();

            // From reading the spec, it looks like the `error` event is only fired before
            // a `close` event. But the `close` event has more interesting information
            // about the error. So we don't have a listener for `error`, just `close`.
            // https://websockets.spec.whatwg.org/#dom-websocket-onerror
            const error = !wasCloseExpected
                ? new UnavailableError(
                      `WebSocket closed unexpectedly with code ${event.code}${
                          event.reason ? quote`and reason ${event.reason}` : ""
                      }${!event.wasClean ? " (did not exit cleanly)" : ""}`,
                  )
                : null;

            if (error) {
                this._closePromiseResolver.reject(error);
            } else {
                this._closePromiseResolver.resolve();
            }

            if (!this._openPromiseResolver.isSettled()) {
                this._openPromiseResolver.reject(
                    new UnavailableError("WebSocket closed before opening"),
                );
            }
        });

        this._socket.addEventListener("message", event => {
            this._lastMessageReceived = Date.now();

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
                    // If we get a message in our `OpenWaitingForMessageAcknowledgmentsBeforeClose`
                    // state, don't emit it.
                    if (this._state.type === "Open") {
                        this._messageEvent.emit(message.message);
                    }
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

                    // Once all our pending messages have been acknowledged, actually close
                    // the client.
                    if (
                        this._state.type === "SoftClosedWhileWaitingForMessageAcknowledgments" &&
                        this._acknowledgementPromiseResolverByMessageId.size === 0
                    ) {
                        this._state = {type: "Closed"};
                        this._socket.close();
                    }
                    break;
                }
                case "Pong": {
                    pingTimeout?.clear();
                    pingTimeout = createTimeout(sendPing, webSocketExpirationTimeoutMs / 2);

                    pongPromiseResolver?.resolve();
                    pongPromiseResolver = undefined;
                    break;
                }
                default:
                    throw exhaustive(message);
            }
        });
    }

    /**
     * Send a message through the socket.
     *
     * If the socket is not currently connected then we queue messages to send once
     * the socket connects.
     */
    public sendMessage(message: MessageFromClient): Promise<void> {
        return this._getContext().tracer.withSpan(
            sendWebSocketMessageSpanName,
            async (context, span) => {
                assert(
                    this._state.type === "Connecting" || this._state.type === "Open",
                    "Can not send message to a closed WebSocket",
                );

                const messageId = generateId<WebSocketMessageId>();

                span.addData({webSocket: {messageType: message.type}});

                const serializedMessage = this._messageFromClientSchema.serialize({
                    type: "Message",
                    messageId,
                    message,
                    tracerContext: span.getPropagationContext(),
                });

                switch (this._state.type) {
                    case "Connecting": {
                        this._state.pendingSerializedMessages.push(
                            JSON.stringify(serializedMessage),
                        );
                        break;
                    }
                    case "Open": {
                        this._socket.send(JSON.stringify(serializedMessage));
                        break;
                    }
                    default:
                        throw exhaustive(this._state);
                }

                const promiseResolver = createPromiseResolver();
                this._acknowledgementPromiseResolverByMessageId.set(messageId, promiseResolver);
                return promiseResolver.promise;
            },
        );
    }

    /**
     * Listen to messages received from the socket.
     *
     * Will only fire when the socket is connected.
     */
    public subscribeToMessage(handler: (message: MessageFromServer) => void): () => void {
        return this._messageEvent.subscribe(handler);
    }

    /**
     * Close the WebSocket. You will immediately no longer be able to send
     * it messages.
     *
     * If we have some previously sent messages we are waiting on acknowledgments
     * for then the underlying WebSocket won't actually close until we get those
     * acknowledgements. No new messages will be sent in the meantime.
     *
     * Returns a promise that resolves when the WebSocket actually closes.
     */
    public async close(): Promise<void> {
        assert(
            this._state.type === "Connecting" || this._state.type === "Open",
            "WebSocket is already closed",
        );

        if (this._acknowledgementPromiseResolverByMessageId.size === 0) {
            this._state = {type: "Closed"};
            this._socket.close();
            return;
        }

        this._state = {type: "SoftClosedWhileWaitingForMessageAcknowledgments"};

        await this._getContext().tracer.withSpan(sendWebSocketMessageSpanName, (context, span) => {
            span.addData({
                webSocket: {messageType: "SoftCloseWhileWaitingForMessageAcknowledgments"},
            });

            const serializedMessage = this._messageFromClientSchema.serialize({
                type: "SoftCloseWhileWaitingForMessageAcknowledgments",
                tracerContext: span.getPropagationContext(),
            });
            this._socket.send(JSON.stringify(serializedMessage));

            return this._closePromiseResolver.promise;
        });
    }

    /**
     * Wait for the WebSocket to close. If the WebSocket closes cleanly after the
     * developer calls `close()` then this will resolve. If the WebSocket closes
     * unexpectedly then this will reject.
     */
    public waitForClose() {
        return this._closePromiseResolver.promise;
    }

    /**
     * Wait for the WebSocket to open. If the WebSocket never opens then this
     * will reject.
     */
    public waitForOpen() {
        return this._openPromiseResolver.promise;
    }
}
