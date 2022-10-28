import {InternalError} from "~/shared/error/error";
import {EventEmitter, Unsubscribe} from "~/shared/helpers/control/event-emitter";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema";

export type WebsocketClientState =
    | {
          readonly type: "disconnected";
          readonly socket?: never;
      }
    | {
          readonly type: "connecting" | "connected";
          readonly socket: WebSocket;
      };

const reconnectTimeoutBaseMs = 1200;
const maxReconnectTimeoutMs = 2500;
const messageReconnectTimeoutMs = 30000;

export class WebSocketClient<ReceivedMessage, SentMessage> {
    static httpToWs(url: string) {
        return url.replace(/^http(s?):\/\//, "ws$1://");
    }

    private shouldConnect = false;
    private state: WebsocketClientState = {type: "disconnected"};
    private readonly connectEvent = new EventEmitter();
    private readonly disconnectEvent = new EventEmitter();
    private readonly messageEvent = new EventEmitter<[message: ReceivedMessage]>();
    private unsuccessfulReconnects = 0;
    private lastMessageReceived = Date.now();
    private pendingMessages: Array<SchemaSerializedValue> = [];

    constructor(
        private readonly receivedMessageSchema: Schema<ReceivedMessage>,
        private readonly sentMessageSchema: Schema<SentMessage>,
        private readonly url: string,
    ) {}

    onConnect(cb: () => void): Unsubscribe {
        return this.connectEvent.subscribe(cb);
    }
    onDisconnect(cb: () => void): Unsubscribe {
        return this.disconnectEvent.subscribe(cb);
    }

    getSocketIfExists(): WebSocket | null {
        return this.state.socket ?? null;
    }

    private setupConnection() {
        const socket = new WebSocket(this.url);
        this.state = {type: "connecting", socket};

        let pingTimeout: NodeJS.Timeout | undefined;

        const sendPing = () => {
            if (this.state.type === "connected" && this.state.socket === socket) {
                this.sendRawMessage("ping");
            }
        };

        const checkConnectionInterval = setInterval(() => {
            if (socket !== this.getSocketIfExists()) {
                return;
            }

            if (messageReconnectTimeoutMs < Date.now() - this.lastMessageReceived) {
                socket.close();
            }
        }, messageReconnectTimeoutMs / 2);

        socket.addEventListener("message", event => {
            this.lastMessageReceived = Date.now();
            this.unsuccessfulReconnects = 0;

            const {data} = event;
            if (data === "ping") {
                this.sendRawMessage("pong");
                return;
            }
            if (data === "pong") {
                clearTimeout(pingTimeout);
                pingTimeout = setTimeout(sendPing, messageReconnectTimeoutMs / 2);
                return;
            }
            const message = this.receivedMessageSchema.deserialize(JSON.parse(data));
            this.messageEvent.emit(message);
        });

        const onClose = () => {
            if (socket !== this.getSocketIfExists()) {
                return;
            }

            const wasConnected = this.state.type === "connected";
            this.state = {type: "disconnected"};
            this.disconnectEvent.emit();
            clearTimeout(pingTimeout);
            clearInterval(checkConnectionInterval);

            if (this.shouldConnect) {
                if (!wasConnected) {
                    this.unsuccessfulReconnects++;
                }
                setTimeout(() => {
                    this.setupConnection();
                }, Math.min(maxReconnectTimeoutMs, Math.log10(this.unsuccessfulReconnects + 1) * reconnectTimeoutBaseMs));
            }
        };

        socket.addEventListener("close", onClose);
        socket.addEventListener("error", onClose);

        socket.addEventListener("open", () => {
            if (this.state.type === "connecting" && this.state.socket === socket) {
                this.lastMessageReceived = Date.now();
                this.state = {type: "connected", socket};
                if (this.pendingMessages.length) {
                    for (const message of this.pendingMessages) {
                        this.sendRawMessage(JSON.stringify(message));
                    }
                    this.pendingMessages = [];
                }
                this.connectEvent.emit();
                pingTimeout = setTimeout(sendPing, messageReconnectTimeoutMs / 2);
            }
        });
    }

    private sendRawMessage(message: string) {
        if (this.state.type === "connected") {
            this.state.socket.send(message);
        } else {
            throw new InternalError("Cannot send message when socket is not connected");
        }
    }

    send(message: SentMessage) {
        const serialized = this.sentMessageSchema.serialize(message);
        if (this.state.type === "connected") {
            this.state.socket.send(JSON.stringify(serialized));
        } else {
            this.pendingMessages.push(serialized);
        }
    }

    onMessage(handler: (message: ReceivedMessage) => void): Unsubscribe {
        return this.messageEvent.subscribe(handler);
    }

    connect() {
        this.shouldConnect = true;
        this.setupConnection();
    }

    disconnect() {
        this.shouldConnect = false;
        const socket = this.getSocketIfExists();
        if (socket) {
            socket.close();
        }
    }
}
