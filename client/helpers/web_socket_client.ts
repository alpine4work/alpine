import {InternalError, UnknownError} from "~/shared/error/error";
import {createInterval} from "~/shared/helpers/async/interval";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {EventEmitter} from "~/shared/helpers/control/event_emitter";
import {expirationTimeoutMs} from "~/shared/helpers/web_socket_shared";
import {
    SchemaDeserializationError,
    SchemaSerializedValue,
    UnionSchema,
} from "~/shared/schema/schema";

const reconnectTimeoutBaseMs = 1200;
const maxReconnectTimeoutMs = 2500;

type WebsocketClientState =
    | {
          readonly type: "disconnected";
          readonly socket?: never;
      }
    | {
          readonly type: "connecting" | "connected";
          readonly socket: WebSocket;
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
 */
// TODO(calebmer): Add feature to kill the WebSocket client after some time
// when the browser tab is hidden.
export class WebSocketClient<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
> {
    private _shouldConnect = false;
    private _state: WebsocketClientState = {type: "disconnected"};
    private readonly _connectEvent = new EventEmitter();
    private readonly _disconnectEvent = new EventEmitter<Error | null>();
    private readonly _messageEvent = new EventEmitter<MessageFromServer>();
    private _unsuccessfulReconnects = 0;
    private _lastMessageReceived = Date.now();
    private _pendingSerializedMessages: Array<SchemaSerializedValue> = [];

    constructor(
        // NOTE(calebmer): Force schemas to be union schemas so the protocol can evolve
        // in the future.
        private readonly _messageFromClientSchema: UnionSchema<MessageFromClient>,
        private readonly _messageFromServerSchema: UnionSchema<MessageFromServer>,
        private readonly _url: string,
    ) {}

    /**
     * Connect to the WebSocket.
     *
     * If the socket unexpectedly disconnects then we will automatically reconnect.
     */
    connect() {
        this._shouldConnect = true;
        this._setupConnection();
    }

    /**
     * Disconnects from the WebSocket.
     */
    disconnect() {
        this._shouldConnect = false;
        this._state.socket?.close();
    }

    /**
     * Listen to when the WebSocket client successfully connects to the server.
     *
     * Should be fired after you call `connect()`. If the socket disconnects and
     * then reconnects it will be fired when the socket successfully reconnects.
     */
    subscribeToConnect(listener: () => void): () => void {
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
    subscribeToDisconnect(listener: (error: Error | null) => void): () => void {
        return this._disconnectEvent.subscribe(listener);
    }

    /**
     * Send a message through the socket.
     *
     * If the socket is not currently connected then we queue messages to send once
     * the socket connects.
     */
    sendMessage(message: MessageFromClient) {
        const serializedMessage = this._messageFromClientSchema.serialize(message);
        if (this._state.type === "connected") {
            this._state.socket.send(JSON.stringify(serializedMessage));
        } else {
            this._pendingSerializedMessages.push(serializedMessage);
        }
    }

    /**
     * Listen to messages received from the socket.
     *
     * Will only fire when the socket is connected.
     */
    subscribeToMessage(handler: (message: MessageFromServer) => void): () => void {
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
        this._state = {type: "connecting", socket};

        let pingTimeout: Timeout | undefined;

        const sendPing = () => {
            if (this._state.type === "connected" && this._state.socket === socket) {
                sendRawMessage("ping");
            }
        };

        const checkConnectionInterval = createInterval(() => {
            assert(this._state.type === "connecting" || this._state.type === "connected");
            assert(this._state.socket === socket);

            if (expirationTimeoutMs < Date.now() - this._lastMessageReceived) {
                socket.close();
            }
        }, expirationTimeoutMs / 2);

        socket.addEventListener("open", () => {
            assert(this._state.type === "connecting");
            assert(this._state.socket === socket);

            this._lastMessageReceived = Date.now();
            this._state = {type: "connected", socket};
            if (this._pendingSerializedMessages.length) {
                for (const message of this._pendingSerializedMessages) {
                    sendRawMessage(JSON.stringify(message));
                }
                this._pendingSerializedMessages = [];
            }
            this._connectEvent.emit();
            pingTimeout = createTimeout(sendPing, expirationTimeoutMs / 2);
        });

        socket.addEventListener("close", event => {
            assert(this._state.type === "connecting" || this._state.type === "connected");
            assert(this._state.socket === socket);

            const wasClosedBeforeConnected =
                this._state.type === "connecting" && !this._shouldConnect;

            // From reading the spec, it looks like the `error` event is only fired before
            // a `close` event. But the `close` event has more interesting information
            // about the error. So we don't have a listener for `error`, just `close`.
            // https://websockets.spec.whatwg.org/#dom-websocket-onerror
            const error =
                (event.code !== 1000 || !event.wasClean) && !wasClosedBeforeConnected
                    ? new UnknownError(
                          `WebSocket ${
                              event.wasClean ? "closed cleanly" : "did not close cleanly"
                          } with error code ${event.code} and reason ${JSON.stringify(
                              event.reason,
                          )}`,
                      )
                    : null;

            const wasConnected = this._state.type === "connected";
            this._state = {type: "disconnected"};
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
            this._lastMessageReceived = Date.now();
            this._unsuccessfulReconnects = 0;

            const {data} = event;
            if (data === "ping") {
                sendRawMessage("pong");
                return;
            }
            if (data === "pong") {
                pingTimeout?.clear();
                pingTimeout = createTimeout(sendPing, expirationTimeoutMs / 2);
                return;
            }

            try {
                const serializedMessage = JSON.parse(data);
                const message = this._messageFromServerSchema.deserialize(serializedMessage);
                this._messageEvent.emit(message);
            } catch (error) {
                // Reclassify deserialization errors as internal errors if we can't deserialize
                // the data coming from our WebSocket.
                if (error instanceof SchemaDeserializationError)
                    throw new InternalError(error.message, {cause: error});

                throw error;
            }
        });

        function sendRawMessage(message: string) {
            socket.send(message);
        }
    }
}
