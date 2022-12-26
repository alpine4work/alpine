import {AuthenticatedAuthContextModule} from "~/server/context/auth_context_module";
import {AwsContextModule} from "~/server/context/aws_context_module";
import {RequestContext} from "~/server/context/request_context";
import {Session} from "~/server/dynamo/accounts_table";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module";
import {Context} from "~/shared/context/context";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {
    ErrorBase,
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
} from "~/shared/error/error";
import {ErrorCode} from "~/shared/error/error_code";
import {isHttp500ErrorCode} from "~/shared/error/is_http_500_error_code";
import {Interval, createInterval} from "~/shared/helpers/async/interval";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {assert} from "~/shared/helpers/control/assert";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {expirationTimeoutMs} from "~/shared/helpers/web_socket_shared";
import {Id} from "~/shared/id/id";
import {Schema, UnionSchema} from "~/shared/schema/schema";

export interface WebSocketServerConnectionBase<MessageFromClient extends {type: string}> {
    handleMessage(context: RequestContext, message: MessageFromClient): Promise<void>;
    handleClose?(): void;
}

/**
 * A helper for communicating over WebSockets. See `WebSocketClient` for the
 * client side of this helper.
 */
export class WebSocketServer<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
    Connection extends WebSocketServerConnectionBase<MessageFromClient>,
> {
    private readonly _connections = new Set<
        WebSocketServerConnectionWrapper<MessageFromClient, Connection>
    >();
    private _expirationInterval: Interval | null = null;

    constructor(
        private readonly _context: Context<{
            process: ProcessContextModule;
            tracer: TracerContextModule;
            aws: AwsContextModule;
        }>,
        // NOTE(calebmer): Force schemas to be union schemas so the protocol can evolve
        // in the future.
        private readonly _messageFromClientSchema: UnionSchema<MessageFromClient>,
        private readonly _messageFromServerSchema: UnionSchema<MessageFromServer>,
        private readonly _createConnection: (connection: {
            request: Request;
            sendMessage: (message: MessageFromServer) => void;
            sendMessageToOthers: (message: MessageFromServer) => void;
            iterateOtherConnections: () => Iterable<Connection>;
        }) => Connection,
    ) {}

    /**
     * Upgrade an HTTP request to a WebSocket connection.
     */
    public upgrade(requestContext: RequestContext, request: Request): Response {
        if (request.headers.get("Upgrade") !== "websocket")
            throw new InvalidArgumentError("Not a WebSocket request");

        const socketPair = new WebSocketPair();
        const clientSocket = socketPair[0];
        const serverSocket = socketPair[1];

        const response = new Response(null, {status: 101, webSocket: clientSocket});

        // @ts-expect-error: Why aren't my cloudflare types getting picked up properly?
        serverSocket.accept();

        const sendMessage = (message: MessageFromServer) => {
            const serializedMessage = this._messageFromServerSchema.serialize(message);
            const serializedMessageString = JSON.stringify(serializedMessage);
            connection.sendRawMessage(serializedMessageString);
        };

        const sendMessageToOthers = (message: MessageFromServer) => {
            const serializedMessage = this._messageFromServerSchema.serialize(message);
            const serializedMessageString = JSON.stringify(serializedMessage);

            for (const otherConnection of this._connections) {
                if (otherConnection === connection) continue;
                otherConnection.sendRawMessage(serializedMessageString);
            }
        };

        const iterateOtherConnections = (): Iterable<Connection> => {
            return filterMapIterable(this._connections, otherConnection =>
                otherConnection !== connection ? otherConnection.connection : null,
            );
        };

        const actualConnection = this._createConnection({
            request,
            sendMessage,
            sendMessageToOthers,
            iterateOtherConnections,
        });

        const connection = new WebSocketServerConnectionWrapper(
            this._context,
            serverSocket,
            this._messageFromClientSchema,
            actualConnection,
            requestContext.auth.getSessionId(),
        );

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
                    if (connection.isClosed()) {
                        this._handleConnectionClose(connection);
                    }
                }
            }, expirationTimeoutMs / 2);
        }

        serverSocket.addEventListener("close", () => {
            this._handleConnectionClose(connection);
        });

        return response;
    }

    /**
     * Close the connection and clean it up from our internal state.
     *
     * Idempotent since we've sometimes observed the WebSocket `close` event not
     * firing so we call this function multiple times when a socket is closing.
     */
    private _handleConnectionClose(
        connection: WebSocketServerConnectionWrapper<MessageFromClient, Connection>,
    ) {
        if (this._connections.delete(connection)) {
            try {
                connection.connection.handleClose?.();
            } catch (error) {
                // TODO(calebmer): Actually report error
                // eslint-disable-next-line no-console
                console.error(error);
            }
        }

        // When we are out of connections, clear our interval.
        if (this._connections.size === 0 && this._expirationInterval !== null) {
            this._expirationInterval.clear();
            this._expirationInterval = null;
        }
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

    /**
     * Close all connected clients.
     */
    public closeAll() {
        for (const connection of this._connections) {
            connection.close(1001, "Closing all WebSocket connections");

            // NOTE(calebmer): In case the `close` event wasn't fired manually call our
            // event handler. Since I've seen the close event not fire before in response
            // to calling `close()` I'm paranoid and adding a second call here.
            this._handleConnectionClose(connection);
        }
    }
}

class WebSocketServerConnectionWrapper<
    MessageFromClient extends {type: string},
    Connection extends WebSocketServerConnectionBase<MessageFromClient>,
> {
    private _lastMessageTimeMs: number = Date.now();

    constructor(
        private readonly _context: Context<{
            process: ProcessContextModule;
            tracer: TracerContextModule;
            aws: AwsContextModule;
        }>,
        private readonly _socket: WebSocket,
        private readonly _messageFromClientSchema: Schema<MessageFromClient>,
        public readonly connection: Connection,
        private readonly _sessionId: Id,
    ) {
        this._socket.addEventListener("message", event => {
            runPromiseWithoutAwaiting(async () => {
                try {
                    // TODO(calebmer): Can we at least give this some kind of TTL in-memory cache??
                    // TODO(calebmer): Can we put this in a trace?
                    const session = await Session.get(this._context, this._sessionId);
                    if (!session)
                        throw new NotFoundError("Session was revoked after the connection began");

                    await this._context.with(
                        {
                            auth: new AuthenticatedAuthContextModule(session),
                            rpc: new LocalRpcContextModule(),
                        },
                        async (context: RequestContext) => {
                            this._lastMessageTimeMs = Date.now();

                            if (event.data === "pong") {
                                // Updating the last message time is all the pong message does.
                                return;
                            }

                            if (event.data === "ping") {
                                this.sendRawMessage("pong");
                                return;
                            }

                            let serializedMessage;
                            try {
                                serializedMessage = JSON.parse(event.data);
                            } catch (error) {
                                // Classify JSON parse errors
                                throw new InvalidArgumentError((error as any).message, {
                                    cause: error,
                                });
                            }

                            const message =
                                this._messageFromClientSchema.deserialize(serializedMessage);

                            await this.connection.handleMessage(context, message);
                        },
                    );
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
            this.close(1002, "WebSocket connection expired due to inactivity");
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

    /**
     * Close the underlying WebSocket with the provided code and reason.
     *
     * The close codes can be found [here][1]. The reason string can be an
     * arbitrary string explaining why we are closing.
     *
     * [1]: https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1
     */
    public close(code?: number, reason?: string) {
        this._socket.close(code, reason);
    }
}
