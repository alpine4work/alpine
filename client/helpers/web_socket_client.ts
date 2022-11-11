import {InternalError, UnknownError} from "~/shared/error/error";
import {scheduleException} from "~/shared/helpers/async/schedule_exception";
import {assert} from "~/shared/helpers/control/assert";
import {EventEmitter} from "~/shared/helpers/control/event_emitter";
import {Schema, SchemaDeserializationError, SchemaSerializedValue} from "~/shared/schema/schema";

const reconnectTimeoutBaseMs = 1200;
const maxReconnectTimeoutMs = 2500;
const messageReconnectTimeoutMs = 30000;

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
 * A helper for communicating over a WebSocket.
 *
 * Features:
 *
 * - Type safe messages using our schema framework.
 * - Automatic reconnection if the socket disconnects.
 * - Automatic heart beating so the server knows our WebSocket is still alive
 *   and we know our server is still alive.
 */
export class WebSocketClient<ReceivedMessage, SentMessage> {
    static httpToWs(url: string) {
        return url.replace(/^http(s?):\/\//, "ws$1://");
    }

    private _shouldConnect = false;
    private _state: WebsocketClientState = {type: "disconnected"};
    private readonly _connectEvent = new EventEmitter();
    private readonly _disconnectEvent = new EventEmitter();
    private readonly _messageEvent = new EventEmitter<ReceivedMessage>();
    private _unsuccessfulReconnects = 0;
    private _lastMessageReceived = Date.now();
    private _pendingMessages: Array<SchemaSerializedValue> = [];

    constructor(
        private readonly _receivedMessageSchema: Schema<ReceivedMessage>,
        private readonly _sentMessageSchema: Schema<SentMessage>,
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
        const socket = this._getSocketIfExists();
        if (socket) {
            socket.close();
        }
    }

    /**
     * Listen to when the WebSocket client successfully connects to the server.
     *
     * Should be fired after you call `connect()`. If the socket disconnects and
     * then reconnects it will be fired when the socket successfully reconnects.
     */
    onConnect(cb: () => void): () => void {
        return this._connectEvent.subscribe(cb);
    }

    /**
     * Listen to when the WebSocket disconnects after connecting to the server.
     *
     * Will be fired after you call `disconnect()`. If the socket disconnects
     * unexpectedly due to the server closing or temporary loss of internet then we
     * will fire this event.
     */
    onDisconnect(cb: () => void): () => void {
        return this._disconnectEvent.subscribe(cb);
    }

    /**
     * Send a message through the socket.
     *
     * If the socket is not currently connected then we queue messages to send once
     * the socket connects.
     */
    send(message: SentMessage) {
        const serialized = this._sentMessageSchema.serialize(message);
        if (this._state.type === "connected") {
            this._state.socket.send(JSON.stringify(serialized));
        } else {
            this._pendingMessages.push(serialized);
        }
    }

    /**
     * Listen to messages received from the socket.
     *
     * Will only fire when the socket is connected.
     */
    onMessage(handler: (message: ReceivedMessage) => void): () => void {
        return this._messageEvent.subscribe(handler);
    }

    private _getSocketIfExists(): WebSocket | null {
        return this._state.socket ?? null;
    }

    private _setupConnection() {
        assert(this._state.type === "disconnected");

        const socket = new WebSocket(this._url);
        this._state = {type: "connecting", socket};

        let pingTimeout: NodeJS.Timeout | undefined;

        const sendPing = () => {
            if (this._state.type === "connected" && this._state.socket === socket) {
                sendRawMessage("ping");
            }
        };

        const checkConnectionInterval = setInterval(() => {
            if (socket !== this._getSocketIfExists()) {
                return;
            }

            if (messageReconnectTimeoutMs < Date.now() - this._lastMessageReceived) {
                socket.close();
            }
        }, messageReconnectTimeoutMs / 2);

        socket.addEventListener("message", event => {
            this._lastMessageReceived = Date.now();
            this._unsuccessfulReconnects = 0;

            const {data} = event;
            if (data === "ping") {
                sendRawMessage("pong");
                return;
            }
            if (data === "pong") {
                clearTimeout(pingTimeout);
                pingTimeout = setTimeout(sendPing, messageReconnectTimeoutMs / 2);
                return;
            }

            try {
                const message = this._receivedMessageSchema.deserialize(JSON.parse(data));
                this._messageEvent.emit(message);
            } catch (error) {
                // Reclassify deserialization errors as internal errors if we can't deserialize
                // the data coming from our WebSocket.
                if (error instanceof SchemaDeserializationError)
                    throw new InternalError(error.message, {cause: error});

                throw error;
            }
        });

        const onClose = () => {
            if (socket !== this._getSocketIfExists()) {
                return;
            }

            const wasConnected = this._state.type === "connected";
            this._state = {type: "disconnected"};
            if (wasConnected) this._disconnectEvent.emit();
            clearTimeout(pingTimeout);
            clearInterval(checkConnectionInterval);

            if (this._shouldConnect) {
                if (!wasConnected) {
                    this._unsuccessfulReconnects++;
                }
                setTimeout(() => {
                    // We may not be disconnected anymore if someone called `connect()`.
                    if (this._state.type !== "disconnected") return;

                    this._setupConnection();
                }, Math.min(maxReconnectTimeoutMs, Math.log10(this._unsuccessfulReconnects + 1) * reconnectTimeoutBaseMs));
            }
        };

        socket.addEventListener("close", onClose);

        socket.addEventListener("error", event => {
            scheduleException(
                new UnknownError(
                    `WebSocket closed with ${
                        "code" in event ? "an error" : `error code ${(event as any).code}`
                    }`,
                    {cause: event},
                ),
            );
            onClose();
        });

        socket.addEventListener("open", () => {
            if (this._state.type === "connecting" && this._state.socket === socket) {
                this._lastMessageReceived = Date.now();
                this._state = {type: "connected", socket};
                if (this._pendingMessages.length) {
                    for (const message of this._pendingMessages) {
                        sendRawMessage(JSON.stringify(message));
                    }
                    this._pendingMessages = [];
                }
                this._connectEvent.emit();
                pingTimeout = setTimeout(sendPing, messageReconnectTimeoutMs / 2);
            }
        });

        function sendRawMessage(message: string) {
            socket.send(message);
        }
    }
}
