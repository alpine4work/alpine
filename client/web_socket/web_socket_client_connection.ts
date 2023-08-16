import {AppContext} from "~/client/context/app_context.js";
import {InternalError, UnavailableError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {createInterval} from "~/shared/helpers/async/interval.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {WebSocketProcedureRequestId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";
import {webSocketExpirationTimeoutMs} from "~/shared/web_socket/web_socket_expiration_timeout_ms.js";
import {
    WebSocketProtocolBase,
    WebSocketProtocolEventType,
    WebSocketProtocolProceduresType,
} from "~/shared/web_socket/web_socket_protocol.js";
import {
    WebSocketMessageFromClient,
    WebSocketMessageFromServer,
    createWebSocketMessageFromClientSchema,
    createWebSocketMessageFromServerSchema,
} from "~/shared/web_socket/web_socket_schema.js";

type WebsocketClientConnectionState =
    | {
          readonly type: "Connecting";
          readonly pendingSerializedMessages: Array<string>;
      }
    | {
          readonly type: "Open";
      }
    | {
          readonly type: "SoftClosedWhileWaitingForProcedureResponses";
      }
    | {
          readonly type: "Closed";
      };

function getSendWebSocketMessageSpanName(messageType: string) {
    return `Sent WebSocket message ${messageType}`;
}

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
 * This represents a single WebSocket connection. Over the course of an
 * application there may be transient WebSocket errors we want to reconnect.
 * This is managed by `WebSocketClient`.
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
 * `WebSocketClient` which adds a couple other essential features. Like trying to
 * reconnect after a network interruption and closing the connection when the
 * browser tab is hidden.
 */
export class WebSocketClientConnection<Protocol extends WebSocketProtocolBase> {
    private readonly _getContext: () => AppContext;
    private readonly _messageFromClientSchema: Schema<WebSocketMessageFromClient<Protocol>>;
    private readonly _messageFromServerSchema: Schema<WebSocketMessageFromServer<Protocol>>;
    private readonly _events = new EventEmitter<WebSocketProtocolEventType<Protocol>>();
    private readonly _openPromiseResolver = createPromiseResolver();
    private readonly _closePromiseResolver = createPromiseResolver();
    private readonly _socket: WebSocket;
    private _state: WebsocketClientConnectionState;
    private _lastMessageReceived = Date.now();
    private readonly _procedureResponsePromiseResolverByRequestId = new Map<
        WebSocketProcedureRequestId,
        PromiseResolver<{}>
    >();

    constructor(getContext: () => AppContext, protocol: Protocol, url: string) {
        this._getContext = getContext;
        this._messageFromClientSchema = createWebSocketMessageFromClientSchema(protocol);
        this._messageFromServerSchema = createWebSocketMessageFromServerSchema(protocol);

        this._state = {type: "Connecting", pendingSerializedMessages: []};

        this._socket = new WebSocket(resolveWebSocketUrl(url));

        let pingTimeout: Timeout | undefined;
        let pongPromiseResolver: PromiseResolver<void> | undefined;

        const sendPing = () => {
            if (this._state.type !== "Open") return;

            const messageType = "Ping";

            void this._getContext().tracer.withSpan(
                getSendWebSocketMessageSpanName(messageType),
                async (context, span) => {
                    span.addData({webSocket: {messageType}});

                    if (!pongPromiseResolver) pongPromiseResolver = createPromiseResolver();

                    const serializedMessage = this._messageFromClientSchema.serialize({
                        type: messageType,
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
            const wasOpen = this._state.type === "Open";
            const wasConnecting = this._state.type === "Connecting";
            if (!wasCloseExpected) this._state = {type: "Closed"};

            pingTimeout?.clear();
            checkConnectionInterval.clear();

            // When the WebSocket closes, resolve our ping promise since we won't
            // be getting a pong from our new connection. We resolve instead of reject
            // since it's expected we won't receive a pong if our socket closes. The socket
            // closing itself may be in error but that will be reported elsewhere.
            pongPromiseResolver?.resolve();
            pongPromiseResolver = undefined;

            // When the WebSocket closes, reject all messages that haven't been
            // acknowledged since we will not be receiving an acknowledgement for them. We
            // do not resubmit messages when reopening the WebSocket.
            for (const promiseResolver of this._procedureResponsePromiseResolverByRequestId.values()) {
                promiseResolver.reject(
                    new UnavailableError("WebSocket closed before procedure response", {
                        displayMessage: errorDisplayMessage`Your connection to our servers was ended unexpectedly. Please try again.`,
                    }),
                );
            }
            this._procedureResponsePromiseResolverByRequestId.clear();

            // From reading the spec, it looks like the `error` event is only fired before
            // a `close` event. But the `close` event has more interesting information
            // about the error. So we don't have a listener for `error`, just `close`.
            // https://websockets.spec.whatwg.org/#dom-websocket-onerror
            const error = !wasCloseExpected
                ? new UnavailableError(
                      `WebSocket closed unexpectedly with code ${event.code}${
                          event.reason ? quote`and reason ${event.reason}` : ""
                      }${!event.wasClean ? " (did not close cleanly)" : ""}`,
                      {
                          displayMessage: wasConnecting
                              ? errorDisplayMessage`Could not connect to the internet. Make sure you are online and try again.`
                              : wasOpen
                              ? errorDisplayMessage`Your connection to our servers was ended unexpectedly. Please try again.`
                              : undefined,
                      },
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

            let message: WebSocketMessageFromServer<Protocol>;
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
                case "ProcedureResponse": {
                    const promiseResolver = this._procedureResponsePromiseResolverByRequestId.get(
                        message.requestId,
                    );
                    if (promiseResolver) {
                        this._procedureResponsePromiseResolverByRequestId.delete(message.requestId);

                        if (message.result.ok) {
                            promiseResolver.resolve(message.result.output);
                        } else {
                            promiseResolver.reject(message.result.error);
                        }
                    }

                    // Once all our pending messages have been acknowledged, actually close
                    // the client.
                    if (
                        this._state.type === "SoftClosedWhileWaitingForProcedureResponses" &&
                        this._procedureResponsePromiseResolverByRequestId.size === 0
                    ) {
                        this._state = {type: "Closed"};
                        this._socket.close();
                    }
                    break;
                }
                case "Event": {
                    // If we get an event in our `SoftClosedWhileWaitingForProcedureResponses`
                    // state, don't emit it.
                    if (this._state.type === "Open") {
                        this._events.emit(message.event);
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
     * Execute a procedure through the socket.
     *
     * If the socket is not currently connected then we queue messages to send once
     * the socket connects.
     */
    public executeProcedure<Name extends keyof WebSocketProtocolProceduresType<Protocol> & string>(
        name: Name,
        input: WebSocketProtocolProceduresType<Protocol>[Name]["input"],
    ): Promise<WebSocketProtocolProceduresType<Protocol>[Name]["output"]> {
        const spanMessageType = `ProcedureRequest:${name}`;

        return this._getContext().tracer.withSpan(
            getSendWebSocketMessageSpanName(spanMessageType),
            async (context, span) => {
                assert(
                    this._state.type === "Connecting" || this._state.type === "Open",
                    "Can not execute a procedure on a closed WebSocket",
                );

                const requestId = generateId<WebSocketProcedureRequestId>();

                span.addData({webSocket: {messageType: spanMessageType}});

                const serializedMessage = this._messageFromClientSchema.serialize({
                    type: "ProcedureRequest",
                    requestId,
                    input: {type: name, ...input},
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

                const promiseResolver = createPromiseResolver<{}>();
                this._procedureResponsePromiseResolverByRequestId.set(requestId, promiseResolver);
                const output = await promiseResolver.promise;

                assert(
                    "type" in output && output.type === name,
                    "Expected procedure output type to be the same as our input type",
                );

                return output;
            },
        );
    }

    /**
     * Listen to events received from the socket.
     *
     * Will only fire when the socket is connected.
     */
    public subscribeToEvents(
        handler: (event: WebSocketProtocolEventType<Protocol>) => void,
    ): () => void {
        return this._events.subscribe(handler);
    }

    /**
     * Close the WebSocket. You will immediately no longer be able to execute
     * procedures.
     *
     * If we have some previously executed procedures we are waiting on
     * acknowledgments for then the underlying WebSocket won't actually close until
     * we get those acknowledgements. No new procedures will be executed in
     * the meantime.
     *
     * Returns a promise that resolves when the WebSocket actually closes.
     */
    public async close(): Promise<void> {
        assert(
            this._state.type === "Connecting" || this._state.type === "Open",
            "WebSocket is already closed",
        );

        if (this._procedureResponsePromiseResolverByRequestId.size === 0) {
            this._state = {type: "Closed"};
            this._socket.close();
            return;
        }

        this._state = {type: "SoftClosedWhileWaitingForProcedureResponses"};

        const messageType = "SoftCloseWhileWaitingForProcedureResponses";

        await this._getContext().tracer.withSpan(
            getSendWebSocketMessageSpanName(messageType),
            (context, span) => {
                span.addData({
                    webSocket: {messageType},
                });

                const serializedMessage = this._messageFromClientSchema.serialize({
                    type: messageType,
                    tracerContext: span.getPropagationContext(),
                });
                this._socket.send(JSON.stringify(serializedMessage));

                return this._closePromiseResolver.promise;
            },
        );
    }

    /**
     * Wait for the WebSocket to close. May not immediately resolve when `close()`
     * is called. We wait for procedure responses before fully closing our
     * WebSocket connection.
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
