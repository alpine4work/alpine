import {Session} from "~/server/dynamo/accounts_table";
import {AuthenticatedAuthContextModule} from "~/server/dynamo/context/auth_context_module";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {CacheContextModule} from "~/shared/context/cache_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {FailedPreconditionError, InvalidArgumentError, NotFoundError} from "~/shared/error/error";
import {isSystemError} from "~/shared/error/is_system_error_code";
import {Interval, createInterval} from "~/shared/helpers/async/interval";
import {assert} from "~/shared/helpers/control/assert";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {expirationTimeoutMs} from "~/shared/helpers/web_socket_shared";
import {generateId} from "~/shared/id/id";
import {SessionId, WebSocketConnectionId} from "~/shared/id/types/id_types";
import {UnionSchema} from "~/shared/schema/schema";
import {TracerSpan} from "~/shared/tracer/tracer_span";

export interface WebSocketServerConnectionBase<MessageFromClient extends {type: string}> {
    handleMessage(
        context: RequestContext,
        message: MessageFromClient,
        span: TracerSpan,
    ): Promise<void>;
    handleClose?(context: ProcessContext): void;
}

/**
 * A helper for communicating over WebSockets in a Durable Object. See
 * `WebSocketClient` for the client side of this class.
 */
export class WebSocketServer<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
    Connection extends WebSocketServerConnectionBase<MessageFromClient>,
> {
    private readonly _processContext: ProcessContext;
    // NOTE(calebmer): Force schemas to be union schemas so the protocol can evolve
    // in the future.
    private readonly _messageFromClientSchema: UnionSchema<MessageFromClient>;
    private readonly _messageFromServerSchema: UnionSchema<MessageFromServer>;
    private readonly _createConnection: (connection: {
        request: Request;
        connectionId: WebSocketConnectionId;
        sendMessage: (context: ProcessContext, message: MessageFromServer) => void;
        sendMessageToOthers: (context: ProcessContext, message: MessageFromServer) => void;
        iterateOtherConnections: () => Iterable<Connection>;
    }) => Connection;

    private readonly _connections = new Map<
        WebSocketConnectionId,
        WebSocketServerConnectionWrapper<MessageFromClient, Connection>
    >();
    private _expirationInterval: Interval | null = null;

    constructor(
        processContext: ProcessContext,
        messageFromClientSchema: UnionSchema<MessageFromClient>,
        messageFromServerSchema: UnionSchema<MessageFromServer>,
        createConnection: (connection: {
            request: Request;
            connectionId: WebSocketConnectionId;
            sendMessage: (context: ProcessContext, message: MessageFromServer) => void;
            sendMessageToOthers: (context: ProcessContext, message: MessageFromServer) => void;
            iterateOtherConnections: () => Iterable<Connection>;
        }) => Connection,
    ) {
        this._processContext = processContext;
        this._messageFromClientSchema = messageFromClientSchema;
        this._messageFromServerSchema = messageFromServerSchema;
        this._createConnection = createConnection;
    }

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

        const sendMessage = (context: ProcessContext, message: MessageFromServer) => {
            const serializedMessage = this._messageFromServerSchema.serialize(message);
            const serializedMessageString = JSON.stringify(serializedMessage);
            connection.sendRawMessage(context, message.type, serializedMessageString);
        };

        const sendMessageToOthers = (context: ProcessContext, message: MessageFromServer) => {
            const {span, finishSpan} = context.tracer.startSpan(
                "Sending all other WebSocket connections a message",
            );
            span.addData({
                webSocket: {
                    connectionId,
                    messageType: message.type,
                },
            });
            context = context.clone({tracer: new TracerContextModule(span)});

            try {
                const serializedMessage = this._messageFromServerSchema.serialize(message);
                const serializedMessageString = JSON.stringify(serializedMessage);

                for (const otherConnection of this._connections.values()) {
                    if (otherConnection.id === connection.id) continue;
                    otherConnection.sendRawMessage(context, message.type, serializedMessageString);
                }

                finishSpan();
            } catch (error) {
                span.addException(error);
                finishSpan();
                throw error;
            }
        };

        const iterateOtherConnections = (): Iterable<Connection> => {
            return filterMapIterable(this._connections.values(), otherConnection =>
                otherConnection.id !== connection.id ? otherConnection.connection : null,
            );
        };

        const connectionProcessContext = this._processContext.tracer.withPropagatedData({
            context: {accountId: requestContext.auth.getAccountId()},
        });

        const connectionId = generateId<WebSocketConnectionId>();

        const actualConnection = this._createConnection({
            request,
            connectionId,
            sendMessage,
            sendMessageToOthers,
            iterateOtherConnections,
        });

        const connection = new WebSocketServerConnectionWrapper({
            id: connectionId,
            processContext: connectionProcessContext,
            socket: serverSocket,
            messageFromClientSchema: this._messageFromClientSchema,
            connection: actualConnection,
            sessionId: requestContext.auth.getSessionId(),
        });

        assert(!this._connections.has(connection.id));
        this._connections.set(connection.id, connection);

        // When we get our first connection, start an interval to expire sockets we
        // haven't received a message from in a while.
        //
        // We need to occasionally send a heartbeat to our clients. If the power goes
        // out we'll have a connection that never closes itself.
        if (this._connections.size === 1) {
            assert(this._expirationInterval === null);

            let currentTimeMs = Date.now();

            // TODO(calebmer): Implement this with durable object alarms so the time
            // works correctly.
            this._expirationInterval = createInterval(() => {
                // This is a workaround for Cloudflare `Date.now()` always returning the same
                // time for a given request. Whenever our interval runs, increment the time by
                // the interval time.
                // https://developers.cloudflare.com/workers/learning/security-model
                currentTimeMs += expirationTimeoutMs / 2;

                void this._processContext.tracer.withSpan(
                    "Expiring idle WebSocket connections",
                    async context => {
                        for (const connection of this._connections.values()) {
                            connection.maybeExpire(context, currentTimeMs);

                            // In case the `close` event wasn't fired, look for closed connections in our
                            // expiration interval loop and remove them from our connection set.
                            //
                            // NOTE(calebmer): I'm observing the `close` event not firing after
                            // `serverSocket.close()` and I'm not sure whether it is a bug or not.
                            if (connection.isClosed()) {
                                this._handleConnectionClose(context, connection);
                            }
                        }
                    },
                );
            }, expirationTimeoutMs / 2);
        }

        serverSocket.addEventListener("close", () => {
            this._handleConnectionClose(
                // Hopefully this is fired synchronously and we get the context object passed
                // into our `close()` call.
                contextForCloseEventListener ?? connectionProcessContext,
                connection,
            );
        });

        // @ts-expect-error: Why aren't my cloudflare types getting picked up properly?
        serverSocket.accept();

        requestContext.tracer.log("WebSocket connected", {
            webSocket: {
                connectionId: connection.id,
            },
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
        context: ProcessContext,
        connection: WebSocketServerConnectionWrapper<MessageFromClient, Connection>,
    ) {
        const existingConnection = this._connections.get(connection.id);
        if (existingConnection && existingConnection === connection) {
            this._connections.delete(connection.id);

            const {span, finishSpan} = context.tracer.startSpan("Close WebSocket connection");
            span.addData({
                webSocket: {
                    connectionId: connection.id,
                },
            });
            try {
                connection.connection.handleClose?.(context);
                finishSpan();
            } catch (error) {
                span.addException(error);
                finishSpan();
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
    public sendMessageToAll(context: ProcessContext, message: MessageFromServer) {
        const {span, finishSpan} = context.tracer.startSpan(
            "Sending all WebSocket connections a message",
        );
        span.addData({
            webSocket: {
                messageType: message.type,
            },
        });
        context = context.clone({tracer: new TracerContextModule(span)});

        try {
            const serializedMessage = this._messageFromServerSchema.serialize(message);
            const serializedMessageString = JSON.stringify(serializedMessage);

            for (const connection of this._connections.values()) {
                connection.sendRawMessage(context, message.type, serializedMessageString);
            }

            finishSpan();
        } catch (error) {
            span.addException(error);
            finishSpan();
            throw error;
        }
    }

    /**
     * Close all connected clients.
     */
    public closeAll(context: ProcessContext) {
        const {span, finishSpan} = context.tracer.startSpan("Closing all WebSocket connections");
        context = context.clone({tracer: new TracerContextModule(span)});

        try {
            for (const connection of this._connections.values()) {
                connection.close(context, 1001, "Closing all WebSocket connections");

                // NOTE(calebmer): In case the `close` event wasn't fired manually call our
                // event handler. Since I've seen the close event not fire before in response
                // to calling `close()` I'm paranoid and adding a second call here.
                this._handleConnectionClose(context, connection);
            }

            finishSpan();
        } catch (error) {
            span.addException(error);
            finishSpan();
            throw error;
        }
    }
}

class WebSocketServerConnectionWrapper<
    MessageFromClient extends {type: string},
    Connection extends WebSocketServerConnectionBase<MessageFromClient>,
> {
    public readonly id: WebSocketConnectionId;
    private readonly _processContext: ProcessContext;
    private readonly _socket: WebSocket;
    private readonly _messageFromClientSchema: UnionSchema<MessageFromClient>;
    public readonly connection: Connection;
    private readonly _sessionId: SessionId;
    private _lastMessageTimeMs: number = Date.now();

    constructor({
        id,
        processContext,
        socket,
        messageFromClientSchema,
        connection,
        sessionId,
    }: {
        id: WebSocketConnectionId;
        processContext: ProcessContext;
        socket: WebSocket;
        messageFromClientSchema: UnionSchema<MessageFromClient>;
        connection: Connection;
        sessionId: SessionId;
    }) {
        this.id = id;
        this._processContext = processContext;
        this._socket = socket;
        this._messageFromClientSchema = messageFromClientSchema;
        this.connection = connection;
        this._sessionId = sessionId;

        this._socket.addEventListener("message", event => {
            this._processContext.process.waitUntil(async () => {
                await this._processContext.tracer.withSpan(
                    "Received message from WebSocket connection",
                    async (context, span) => {
                        try {
                            span.addData({
                                webSocket: {
                                    connectionId: this.id,
                                },
                            });

                            const getSession = async () => {
                                // TODO(calebmer): Can we at least give this some kind of TTL in-memory cache??
                                const session = await Session.get(context, this._sessionId);
                                if (!session)
                                    throw new NotFoundError(
                                        "Session was revoked after the connection began",
                                    );

                                return session;
                            };

                            this._lastMessageTimeMs = Date.now();

                            // In response to a pong event, we update the last message time for this
                            // connection and that's it. Pong events only let us know the client is
                            // still alive.
                            if (event.data === "pong") {
                                span.addData({webSocket: {messageType: "pong"}});

                                // Will throw if the session is expired.
                                await getSession();
                                return;
                            }

                            // In response to a ping event, we want to send "pong" to the client so it
                            // knows we are alive and didn't silently disconnect.
                            if (event.data === "ping") {
                                span.addData({webSocket: {messageType: "ping"}});

                                // Will throw if the session is expired.
                                await getSession();

                                this.sendRawMessage(context, "pong", "pong");
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
                            span.addData({webSocket: {messageType: message.type}});

                            const session = await getSession();

                            await context.with(
                                {
                                    cache: new CacheContextModule(),
                                    auth: new AuthenticatedAuthContextModule(session),
                                },
                                async (context: RequestContext) => {
                                    await this.connection.handleMessage(context, message, span);
                                },
                            );
                        } catch (error) {
                            span.addException(error);

                            // If we got an unexpected error while handling the message close the socket
                            // connection.
                            this.close(context, isSystemError(error) ? 1011 : 1008);
                        }
                    },
                );
            });
        });
    }

    public isClosed(): boolean {
        return this._socket.readyState === 2 || this._socket.readyState === 3;
    }

    public maybeExpire(context: ProcessContext, currentTimeMs: number) {
        // If our socket is already closed then we don't need to expire.
        if (this.isClosed()) {
            return;
        }

        // If we haven't gotten a message from the client in a while, close it. Maybe
        // the client's power went out and it silently went away without telling us.
        if (currentTimeMs - this._lastMessageTimeMs >= expirationTimeoutMs) {
            this.close(context, 1002, "WebSocket connection expired due to inactivity");
            return;
        }

        // If we are halfway to our expiration time send a ping message. The client
        // should immediately send back a pong message updating which updates the last
        // message time and prevents the client from expiring.
        if (currentTimeMs - this._lastMessageTimeMs >= expirationTimeoutMs / 2) {
            this.sendRawMessage(context, "ping", "ping");
            return;
        }
    }

    /**
     * Send a message over our WebSocket connection. Throws an error if the
     * connection is closed!
     */
    public sendRawMessage(context: ProcessContext, messageType: string, message: string) {
        if (this.isClosed())
            throw new FailedPreconditionError("Can not send message to closed WebSocket");

        this._socket.send(message);

        context.tracer.log("Sent WebSocket connection a message", {
            webSocket: {
                connectionId: this.id,
                messageType,
            },
        });
    }

    /**
     * Close the underlying WebSocket with the provided code and reason.
     *
     * The close codes can be found [here][1]. The reason string can be an
     * arbitrary string explaining why we are closing.
     *
     * [1]: https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1
     */
    public close(context: ProcessContext, code?: number, reason?: string) {
        const previousContextForCloseEventListener = contextForCloseEventListener;
        contextForCloseEventListener = context;
        try {
            this._socket.close(code, reason);
        } finally {
            contextForCloseEventListener = previousContextForCloseEventListener;
        }
    }
}

/**
 * Used to pass a `context` object from our `close()` function call to the
 * event listener which logs a close event.
 */
let contextForCloseEventListener: ProcessContext | null = null;
