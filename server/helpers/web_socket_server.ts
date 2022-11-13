import {ErrorBase, FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error";
import {ErrorCode} from "~/shared/error/error_code";
import {isHttp500ErrorCode} from "~/shared/error/is_http_500_error_code";
import {Interval, createInterval} from "~/shared/helpers/async/interval";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {assert} from "~/shared/helpers/control/assert";
import {expirationTimeoutMs} from "~/shared/helpers/web_socket_shared";
import {SchemaSerializedValue, UnionSchema} from "~/shared/schema/schema";

/**
 * A helper for communicating over WebSockets. See `WebSocketClient` for the
 * client side of this helper.
 */
export class WebSocketServer<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
> {
    private readonly _connections = new Set<WebSocketServerConnection>();
    private _expirationInterval: Interval | null = null;

    constructor(
        // NOTE(calebmer): Force schemas to be union schemas so the protocol can evolve
        // in the future.
        private readonly _messageFromClientSchema: UnionSchema<MessageFromClient>,
        private readonly _messageFromServerSchema: UnionSchema<MessageFromServer>,
        private readonly _handleMessage: (
            message: MessageFromClient,
            connection: {sendMessage: (message: MessageFromServer) => void},
        ) => Promise<void>,
    ) {}

    /**
     * Upgrade an HTTP request to a WebSocket connection.
     */
    public upgrade(request: Request): Response {
        if (request.headers.get("Upgrade") !== "websocket")
            throw new InvalidArgumentError("Not a WebSocket request");

        const socketPair = new WebSocketPair();
        const clientSocket = socketPair[0];
        const serverSocket = socketPair[1];

        const response = new Response(null, {status: 101, webSocket: clientSocket});

        // @ts-expect-error: Why aren't my cloudflare types getting picked up properly?
        serverSocket.accept();

        const connection = new WebSocketServerConnection(serverSocket, serializedMessage => {
            const message = this._messageFromClientSchema.deserialize(serializedMessage);

            const sendMessage = (message: MessageFromServer) => {
                const serializedMessage = this._messageFromServerSchema.serialize(message);
                const serializedMessageString = JSON.stringify(serializedMessage);
                connection.sendRawMessage(serializedMessageString);
            };

            return this._handleMessage(message, {sendMessage});
        });

        this._connections.add(connection);

        // When we get our first connection, start an interval to expire sockets we
        // haven't received a message from in a while.
        //
        // We need to occasionally send a heartbeat to our clients. If the power goes
        // out we'll have a connection that never closes itself.
        if (this._connections.size === 1) {
            assert(this._expirationInterval === null);

            let currentTimeMs = Date.now();

            this._expirationInterval = createInterval(() => {
                // This is a workaround for Cloudflare `Date.now()` always returning the same
                // time for a given request. Whenever our interval runs, increment the time by
                // the interval time.
                // https://developers.cloudflare.com/workers/learning/security-model
                currentTimeMs += expirationTimeoutMs / 2;

                for (const connection of this._connections) {
                    connection.maybeExpire(currentTimeMs);

                    // In case the `close` event wasn't fired, look for closed connections in our
                    // expiration interval loop and remove them from our connection set.
                    //
                    // NOTE(calebmer): I'm observing the `close` event not firing after
                    // `serverSocket.close()` and I'm not sure whether it is a bug or not.
                    if (connection.isClosed()) this._connections.delete(connection);
                }

                // When we are out of connections, clear our interval.
                if (this._connections.size === 0 && this._expirationInterval !== null) {
                    this._expirationInterval.clear();
                    this._expirationInterval = null;
                }
            }, expirationTimeoutMs / 2);
        }

        serverSocket.addEventListener("close", () => {
            this._connections.delete(connection);

            // When we are out of connections, clear our interval.
            if (this._connections.size === 0 && this._expirationInterval !== null) {
                this._expirationInterval.clear();
                this._expirationInterval = null;
            }
        });

        return response;
    }

    /**
     * Send a message to all connected clients.
     */
    public sendMessageToAll(message: MessageFromServer) {
        const serializedMessage = this._messageFromServerSchema.serialize(message);
        const serializedMessageString = JSON.stringify(serializedMessage);

        for (const connection of this._connections) {
            connection.sendRawMessage(serializedMessageString);
        }
    }
}

class WebSocketServerConnection {
    private _lastMessageTimeMs: number = Date.now();

    constructor(
        private readonly _socket: WebSocket,
        private readonly _handleMessage: (message: SchemaSerializedValue) => Promise<void>,
    ) {
        this._socket.addEventListener("message", event => {
            runPromiseWithoutAwaiting(async () => {
                try {
                    this._lastMessageTimeMs = Date.now();

                    if (event.data === "pong") {
                        // Updating the last message time is all the pong message does.
                        return;
                    }

                    if (event.data === "ping") {
                        this.sendRawMessage("pong");
                        return;
                    }

                    let message;
                    try {
                        message = JSON.parse(event.data);
                    } catch (error) {
                        // Classify JSON parse errors
                        throw new InvalidArgumentError((error as any).message, {cause: error});
                    }

                    await this._handleMessage(message);
                } catch (error) {
                    // TODO(calebmer): Actual error reporting
                    // eslint-disable-next-line no-console
                    console.error(error);

                    // If we got an unexpected error while handling the message close the socket
                    // connection.
                    const code = error instanceof ErrorBase ? error.code : ErrorCode.Unknown;
                    this._socket.close(isHttp500ErrorCode(code) ? 1011 : 1008);
                }
            });
        });
    }

    public isClosed(): boolean {
        return this._socket.readyState === 2 || this._socket.readyState === 3;
    }

    public maybeExpire(currentTimeMs: number) {
        // If our socket is already closed then we don't need to expire.
        if (this.isClosed()) {
            return;
        }

        // If we haven't gotten a message from the client in a while, close it. Maybe
        // the client's power went out and it silently went away without telling us.
        if (currentTimeMs - this._lastMessageTimeMs >= expirationTimeoutMs) {
            this._socket.close(1001);
            return;
        }

        // If we are halfway to our expiration time send a ping message. The client
        // should immediately send back a pong message updating which updates the last
        // message time and prevents the client from expiring.
        if (currentTimeMs - this._lastMessageTimeMs >= expirationTimeoutMs / 2) {
            this.sendRawMessage("ping");
            return;
        }
    }

    /**
     * Send a message over our WebSocket connection. Throws an error if the
     * connection is closed!
     */
    public sendRawMessage(message: string) {
        if (this.isClosed())
            throw new FailedPreconditionError("Can not send message to closed WebSocket");

        this._socket.send(message);
    }
}
