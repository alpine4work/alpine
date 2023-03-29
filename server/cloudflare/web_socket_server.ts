import {Session} from "~/server/dynamo/accounts_table";
import {AuthenticatedAuthContextModule} from "~/server/dynamo/context/auth_context_module";
import {ProcessContext} from "~/server/dynamo/context/process_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {validateTracerEventFlatDataForPropagation} from "~/server/tracer/validate_tracer_event_flat_data";
import {webSocketExpirationTimeoutMs} from "~/shared/cloudflare/web_socket_expiration_timeout_ms";
import {
    WebSocketMessageFromClient,
    WebSocketMessageFromServer,
    createWebSocketMessageFromClientSchema,
    createWebSocketMessageFromServerSchema,
} from "~/shared/cloudflare/web_socket_schema";
import {CacheContextModule} from "~/shared/context/cache_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {FailedPreconditionError, InvalidArgumentError, NotFoundError} from "~/shared/error/error";
import {isSystemError} from "~/shared/error/is_system_error_code";
import {Interval, createInterval} from "~/shared/helpers/async/interval";
import {assert} from "~/shared/helpers/control/assert";
import {EventEmitter} from "~/shared/helpers/control/event_emitter";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {generateId} from "~/shared/id/id";
import {AccountId, SessionId, WebSocketConnectionId} from "~/shared/id/types/id_types";
import {Schema, UnionSchema} from "~/shared/schema/schema";
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
    private readonly _messageFromClientSchema: Schema<
        WebSocketMessageFromClient<MessageFromClient>
    >;
    private readonly _messageFromServerSchema: Schema<
        WebSocketMessageFromServer<MessageFromServer>
    >;
    private readonly _createConnection: (connection: {
        connectionId: WebSocketConnectionId;
        sendMessage: (context: ProcessContext, message: MessageFromServer) => void;
        sendMessageToOthers: (context: ProcessContext, message: MessageFromServer) => void;
        iterateOtherConnections: () => Iterable<Connection>;
    }) => Connection;

    private readonly _connections = new Map<
        WebSocketConnectionId,
        WebSocketServerConnectionWrapperBase<Connection>
    >();
    private _expirationInterval: Interval | null = null;

    constructor(
        processContext: ProcessContext,
        messageFromClientSchema: UnionSchema<MessageFromClient>,
        messageFromServerSchema: UnionSchema<MessageFromServer>,
        createConnection: (connection: {
            connectionId: WebSocketConnectionId;
            sendMessage: (context: ProcessContext, message: MessageFromServer) => void;
            sendMessageToOthers: (context: ProcessContext, message: MessageFromServer) => void;
            iterateOtherConnections: () => Iterable<Connection>;
        }) => Connection,
    ) {
        this._processContext = processContext;
        this._messageFromClientSchema =
            createWebSocketMessageFromClientSchema(messageFromClientSchema);
        this._messageFromServerSchema =
            createWebSocketMessageFromServerSchema(messageFromServerSchema);
        this._createConnection = createConnection;
    }

    private _maybeStartExpirationInterval() {
        // When we get our first connection, start an interval to expire sockets we
        // haven't received a message from in a while.
        //
        // We need to occasionally send a heartbeat to our clients. If the power goes
        // out we'll have a connection that never closes itself.
        if (this._connections.size === 0 || this._expirationInterval !== null) return;

        let currentTimeMs = Date.now();

        // TODO(calebmer): Implement this with durable object alarms so the time
        // works correctly.
        this._expirationInterval = createInterval(() => {
            // This is a workaround for Cloudflare `Date.now()` always returning the same
            // time for a given request. Whenever our interval runs, increment the time by
            // the interval time.
            // https://developers.cloudflare.com/workers/learning/security-model
            currentTimeMs += webSocketExpirationTimeoutMs / 2;

            void this._processContext.tracer.withSpan(
                "Expiring idle WebSocket connections",
                async context => {
                    for (const connection of this._connections.values()) {
                        connection.maybeExpire(context, currentTimeMs);

                        // In case the `close` event hasn't fired yet (maybe the connection is in the
                        // process of closing), look for closed connections in our expiration interval
                        // loop and remove them from our connection set.
                        //
                        // NOTE(calebmer, 2022-12-27): I'm observing the `close` event not firing after
                        // `serverSocket.close()` and I'm not sure whether it is a bug or not.
                        //
                        // NOTE(calebmer, 2023-02-23): I think what's happening is the WebSocket moves
                        // into the closing state (so `isClosed()` returns true) but it hasn't fully
                        // closed yet so the `close` event doesn't fire. We could clean the code up a
                        // bit with this knowledge if it's true.
                        if (connection.isClosed()) {
                            this._handleConnectionClose(context, connection);
                        }
                    }
                },
            );
        }, webSocketExpirationTimeoutMs / 2);
    }

    /**
     * Upgrade an HTTP request to a WebSocket connection.
     */
    public upgrade(connectRequestContext: RequestContext, request: Request): Response {
        if (request.headers.get("Upgrade") !== "websocket")
            throw new InvalidArgumentError("Not a WebSocket request");

        const socketPair = new WebSocketPair();
        const clientSocket = socketPair[0];
        const serverSocket = socketPair[1];

        const response = new Response(null, {status: 101, webSocket: clientSocket});

        const sendMessage = (context: ProcessContext, message: MessageFromServer) => {
            connection.sendMessage(context, {
                type: "Message",
                message,
            });
        };

        const sendMessageToOthers = (context: ProcessContext, message: MessageFromServer) => {
            this.sendMessageToOthers(context, connection.id, message);
        };

        const iterateOtherConnections = (): Iterable<Connection> => {
            return filterMapIterable(this._connections.values(), otherConnection =>
                otherConnection.id !== connection.id && !otherConnection.isSoftClosed()
                    ? otherConnection.connection
                    : null,
            );
        };

        const connectionProcessContext = this._processContext.tracer.withPropagatedData({
            context: {accountId: connectRequestContext.auth.getAccountId()},
        });

        const connectionId = generateId<WebSocketConnectionId>();

        const actualConnection = this._createConnection({
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
            messageFromServerSchema: this._messageFromServerSchema,
            connection: actualConnection,
            sessionId: connectRequestContext.auth.getSessionId(),
            sessionAccountId: connectRequestContext.auth.getAccountId(),
        });

        assert(!this._connections.has(connection.id));
        this._connections.set(connection.id, connection);

        this._maybeStartExpirationInterval();

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

        connectRequestContext.tracer.log("WebSocket connected", {
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
        connection: WebSocketServerConnectionWrapperBase<Connection>,
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
            const serializedMessage = this._messageFromServerSchema.serialize({
                type: "Message",
                message,
            });
            const serializedMessageString = JSON.stringify(serializedMessage);

            for (const connection of this._connections.values()) {
                // Don't send new messages to soft closed connections.
                if (connection.isSoftClosed()) continue;

                connection.dangerouslySendRawMessageEvenWhenSoftClosed(
                    context,
                    message.type,
                    serializedMessageString,
                );
            }

            finishSpan();
        } catch (error) {
            span.addException(error);
            finishSpan();
            throw error;
        }
    }

    /**
     * Send a message to connected clients besides the provided connection ID.
     */
    private sendMessageToOthers(
        context: ProcessContext,
        ourConnectionId: WebSocketConnectionId,
        message: MessageFromServer,
    ) {
        const {span, finishSpan} = context.tracer.startSpan(
            "Sending all other WebSocket connections a message",
        );
        span.addData({
            webSocket: {
                messageType: message.type,
            },
        });
        context = context.clone({tracer: new TracerContextModule(span)});

        try {
            const serializedMessage = this._messageFromServerSchema.serialize({
                type: "Message",
                message,
            });
            const serializedMessageString = JSON.stringify(serializedMessage);

            for (const connection of this._connections.values()) {
                if (connection.id === ourConnectionId) continue;

                // Don't send new messages to soft closed connections.
                if (connection.isSoftClosed()) continue;

                connection.dangerouslySendRawMessageEvenWhenSoftClosed(
                    context,
                    message.type,
                    serializedMessageString,
                );
            }

            finishSpan();
        } catch (error) {
            span.addException(error);
            finishSpan();
            throw error;
        }
    }

    /**
     * Iterate through all connected clients.
     */
    public iterateAllConnections() {
        return filterMapIterable(this._connections.values(), connection =>
            !connection.isSoftClosed() ? connection.connection : null,
        );
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

    /**
     * Creates a new test connection for our WebSocket server. Can only be used in
     * Jest unit tests because it does not implement the full WebSocket
     * client/server interface which only works in a trusted environment.
     */
    public connectForTest(
        connectRequestContext: RequestContext,
    ): WebSocketServerTestConnection<MessageFromClient, MessageFromServer, Connection> {
        assert(typeof jest !== "undefined");

        const sendMessage = (context: ProcessContext, message: MessageFromServer) => {
            connection.sendMessage(message);
        };

        const sendMessageToOthers = (context: ProcessContext, message: MessageFromServer) => {
            this.sendMessageToOthers(context, connection.id, message);
        };

        const iterateOtherConnections = (): Iterable<Connection> => {
            return filterMapIterable(this._connections.values(), otherConnection =>
                otherConnection.id !== connection.id && !otherConnection.isSoftClosed()
                    ? otherConnection.connection
                    : null,
            );
        };

        const connectionProcessContext = this._processContext.tracer.withPropagatedData({
            context: {accountId: connectRequestContext.auth.getAccountId()},
        });

        const connectionId = generateId<WebSocketConnectionId>();

        const actualConnection = this._createConnection({
            connectionId,
            sendMessage,
            sendMessageToOthers,
            iterateOtherConnections,
        });

        const connection = new WebSocketServerTestConnectionWrapper({
            id: connectionId,
            processContext: connectionProcessContext,
            messageFromClientSchema: this._messageFromClientSchema,
            messageFromServerSchema: this._messageFromServerSchema,
            connection: actualConnection,
            sessionId: connectRequestContext.auth.getSessionId(),
            sessionAccountId: connectRequestContext.auth.getAccountId(),
        });

        assert(!this._connections.has(connection.id));
        this._connections.set(connection.id, connection);

        this._maybeStartExpirationInterval();

        connection.subscribeToClose(() => {
            this._handleConnectionClose(
                // Hopefully this is fired synchronously and we get the context object passed
                // into our `close()` call.
                contextForCloseEventListener ?? connectionProcessContext,
                connection,
            );
        });

        return {
            id: connection.id,
            connection: connection.connection,
            sendMessage: message => connection.handleMessage(message),
            takeMessages: () => connection.takeMessages(),
            subscribeToMessages: listener => connection.subscribeToMessages(listener),
            close: () => connection.close(),
        };
    }
}

/**
 * WebSocket server connections are implemented either with a real WebSocket
 * client or a test WebSocket client only available in unit tests.
 */
interface WebSocketServerConnectionWrapperBase<Connection> {
    /**
     * A unique identifier for this connection.
     */
    readonly id: WebSocketConnectionId;

    /**
     * The underlying connection object.
     */
    readonly connection: Connection;

    /**
     * Is the connection closed? When closed it accepts no more messages.
     */
    isClosed(): boolean;

    /**
     * Closes the connection. Does nothing if the connection is already closed.
     */
    close(context: ProcessContext, code?: number, reason?: string): void;

    /**
     * Is the connection soft closed? While soft closed we stop sending the
     * connection new messages but wait to fully close until we've sent
     * acknowledgements for any messages previously sent by the client. The client
     * is responsible for fully closing the connection once it has received all of
     * its acknowledgements.
     */
    isSoftClosed(): boolean;

    /**
     * Send a JSON stringified message to the connection. If the connection is
     * closed this does nothing. If the connection is soft closed we still send
     * this message! You should only be sending acknowledgements for previously
     * sent messages to a soft closed client. So you should probably check
     * `isSoftClosed()` before sending your message.
     */
    dangerouslySendRawMessageEvenWhenSoftClosed(
        context: ProcessContext,
        messageType: string,
        message: string,
    ): void;

    /**
     * The WebSocket server will try to occasionally expire connections that have
     * gone offline. When the WebSocket server's expiration check timer triggers it
     * calls this function. Does nothing if the connection is already closed.
     */
    maybeExpire(context: ProcessContext, currentTimeMs: number): void;
}

class WebSocketServerConnectionWrapper<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
    Connection extends WebSocketServerConnectionBase<MessageFromClient>,
> implements WebSocketServerConnectionWrapperBase<Connection>
{
    public readonly id: WebSocketConnectionId;
    private readonly _processContext: ProcessContext;
    private readonly _socket: WebSocket;
    private readonly _messageFromClientSchema: Schema<
        WebSocketMessageFromClient<MessageFromClient>
    >;
    private readonly _messageFromServerSchema: Schema<
        WebSocketMessageFromServer<MessageFromServer>
    >;
    public readonly connection: Connection;
    private readonly _sessionId: SessionId;
    private readonly _sessionAccountId: AccountId;
    private _lastMessageTimeMs: number = Date.now();

    /**
     * Is the connection soft closed? While soft closed the connection can not send
     * or receive new messages. It also stops showing up in
     * `iterateOtherConnections()` so it's not observable by other connections.
     * However it still receives ping/pong events and message acknowledgements.
     * Clients will go into this state when the user requested a close but we still
     * are waiting on some message acknowledgements.
     *
     * The client is expected to close the WebSocket when it is done receiving its
     * message acknowledgements. The server does not keep track of the remaining
     * number of unacknowledged messages.
     */
    private _isSoftClosed = false;

    constructor({
        id,
        processContext,
        socket,
        messageFromClientSchema,
        messageFromServerSchema,
        connection,
        sessionId,
        sessionAccountId,
    }: {
        id: WebSocketConnectionId;
        processContext: ProcessContext;
        socket: WebSocket;
        messageFromClientSchema: Schema<WebSocketMessageFromClient<MessageFromClient>>;
        messageFromServerSchema: Schema<WebSocketMessageFromServer<MessageFromServer>>;
        connection: Connection;
        sessionId: SessionId;
        sessionAccountId: AccountId;
    }) {
        this.id = id;
        this._processContext = processContext;
        this._socket = socket;
        this._messageFromClientSchema = messageFromClientSchema;
        this._messageFromServerSchema = messageFromServerSchema;
        this.connection = connection;
        this._sessionId = sessionId;
        this._sessionAccountId = sessionAccountId;

        this._socket.addEventListener("message", event => {
            this._processContext.process.waitUntil(async () => {
                this._lastMessageTimeMs = Date.now();

                let message: WebSocketMessageFromClient<MessageFromClient>;
                try {
                    const serializedMessage = JSON.parse(event.data);
                    message = this._messageFromClientSchema.deserialize(serializedMessage);
                } catch (error) {
                    this._processContext.tracer
                        .getRoot()
                        .logUncaughtException("Invalid WebSocket message", error);
                    return;
                }

                const spanName = "Received WebSocket message";
                let span: TracerSpan;
                let finishSpan: () => void;
                try {
                    validateTracerEventFlatDataForPropagation(message.tracerContext.data);

                    ({span, finishSpan} = this._processContext.tracer
                        .getRoot()
                        .startSpanFromPropagationContext(spanName, {
                            traceId: message.tracerContext.traceId,
                            parentId: message.tracerContext.parentId,
                            data: message.tracerContext.data,
                        }));
                } catch (error) {
                    this._processContext.tracer
                        .getRoot()
                        .logUncaughtException("Invalid trace propagation context", error);

                    ({span, finishSpan} = this._processContext.tracer
                        .getRoot()
                        .startSpan(spanName));
                }

                await this._processContext.with(
                    {tracer: new TracerContextModule(span)},
                    async context => {
                        try {
                            span.addData({
                                webSocket: {
                                    connectionId: this.id,
                                    messageType:
                                        message.type === "Message"
                                            ? message.message.type
                                            : message.type,
                                },
                            });

                            // If the client soft closed our connection we won't accept new messages. We
                            // still process ping/pong messages since that tells us the connection is
                            // still alive.
                            //
                            // It is important that this comes before any `await`s like our
                            // `await Session.get()` below so we don't have any race conditions between the
                            // `SoftCloseWhileWaitingForMessageAcknowledgments` message and other messages.
                            if (this._isSoftClosed && message.type === "Message")
                                throw new FailedPreconditionError(
                                    "WebSocket connection can not process new messages when soft closed",
                                );

                            // TODO(calebmer): Can we at least give this some kind of TTL in-memory cache??
                            const session = await Session.get(
                                context,
                                this._sessionId,
                                this._sessionAccountId,
                            );
                            if (!session)
                                throw new NotFoundError(
                                    "Session was revoked after the connection began",
                                );

                            switch (message.type) {
                                // In response to a ping event, we want to send "pong" to the client so it
                                // knows we are alive and didn't silently disconnect.
                                case "Ping": {
                                    this.sendMessage(context, {type: "Pong"});
                                    break;
                                }
                                case "Message": {
                                    try {
                                        const actualMessage = message.message;

                                        await context.with(
                                            {
                                                cache: new CacheContextModule(),
                                                auth: new AuthenticatedAuthContextModule(session),
                                            },
                                            async (context: RequestContext) => {
                                                await this.connection.handleMessage(
                                                    context,
                                                    actualMessage,
                                                    span,
                                                );
                                            },
                                        );
                                        this.sendMessage(context, {
                                            type: "AcknowledgeMessage",
                                            messageId: message.messageId,
                                            result: {ok: true},
                                        });
                                    } catch (error) {
                                        span.addException(error);

                                        this.sendMessage(context, {
                                            type: "AcknowledgeMessage",
                                            messageId: message.messageId,
                                            result: {ok: false, error},
                                        });
                                    }
                                    break;
                                }
                                case "SoftCloseWhileWaitingForMessageAcknowledgments": {
                                    if (this._isSoftClosed)
                                        throw new FailedPreconditionError(
                                            "WebSocket connection is already soft closed",
                                        );

                                    this._isSoftClosed = true;
                                    break;
                                }
                                default:
                                    throw exhaustive(message);
                            }
                        } catch (error) {
                            span.addException(error);

                            // If we got an unexpected error while handling the message close the socket
                            // connection.
                            this.close(context, isSystemError(error) ? 1011 : 1008);
                        } finally {
                            finishSpan();
                        }
                    },
                );
            });
        });
    }

    public isClosed(): boolean {
        return this._socket.readyState === 2 || this._socket.readyState === 3;
    }

    public isSoftClosed(): boolean {
        return this.isClosed() || this._isSoftClosed;
    }

    public maybeExpire(context: ProcessContext, currentTimeMs: number) {
        // If our socket is already closed then we don't need to expire.
        if (this.isClosed()) return;

        // If we haven't gotten a message from the client in a while, close it. Maybe
        // the client's power went out and it silently went away without telling us.
        if (currentTimeMs - this._lastMessageTimeMs >= webSocketExpirationTimeoutMs) {
            this.close(context, 1002, "WebSocket connection expired due to inactivity");
            return;
        }
    }

    /**
     * Send a message over our WebSocket connection. Throws an error if the
     * connection is closed!
     */
    public sendMessage(
        context: ProcessContext,
        message: WebSocketMessageFromServer<MessageFromServer>,
    ) {
        // Do not send messages to a soft closed WebSocket. A soft closed WebSocket is
        // in the process of cleaning up and only expects acknowledgements for
        // previously sent messages and pong messages.
        //
        // Once the client receives all of its message acknowledgements then it closes
        // for real.
        if (this._isSoftClosed && message.type === "Message") return;

        const serializedMessage = this._messageFromServerSchema.serialize(message);

        this.dangerouslySendRawMessageEvenWhenSoftClosed(
            context,
            message.type === "Message" ? message.message.type : message.type,
            JSON.stringify(serializedMessage),
        );
    }

    /**
     * Send a message over our WebSocket connection. Throws an error if the
     * connection is closed!
     *
     * We let you call this function directly for performance. When sending a
     * message to many clients at once, it is efficient to only serialize the
     * message once.
     *
     * Dangerous since you must guarantee the message is well-formed as this only
     * takes a string.
     *
     * Will send a message even when the connection is soft closed! We should only
     * be sending ping/pong and acknowledgement messages when soft closed. If you
     * are calling this function you should check `isSoftClosed()` before calling.
     */
    public dangerouslySendRawMessageEvenWhenSoftClosed(
        context: ProcessContext,
        messageType: string,
        message: string,
    ) {
        // Don't send messages to a closed WebSocket. The WebSocket may not have been
        // cleaned up yet because it is closing. We will definitely cleanup the
        // WebSocket on our expiration pass if missed the close event.
        if (this.isClosed()) return;

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
        // WebSocket is already closed.
        if (this.isClosed()) return;

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
 * A connection object to be used for testing our WebSocket server.
 */
export interface WebSocketServerTestConnection<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
    Connection extends WebSocketServerConnectionBase<MessageFromClient>,
> {
    readonly id: WebSocketConnectionId;
    readonly connection: Connection;

    /**
     * Send a message to the WebSocket connection as a client.
     */
    sendMessage(message: MessageFromClient): Promise<void>;

    /**
     * Get all messages sent by the WebSocket server to the client since the last
     * `takeMessages()` call. Calling this function will clear the array so if
     * you call it immediately it will be empty.
     *
     * If you have a subscriber with `subscribeToMessages()` then messages observed
     * by that function will still show up in `takeMessages()`.
     *
     * This function allows you to pull new messages, `subscribeToMessages()` lets
     * the server push new messages to you.
     */
    takeMessages(): Array<MessageFromServer>;

    /**
     * Subscribe to messages from the server as they are published. Returns a
     * function that lets you unsubscribe.
     */
    subscribeToMessages(listener: (message: MessageFromServer) => void): () => void;

    /**
     * Close the connection. Does nothing if the connection is already closed.
     */
    close(): void;
}

class WebSocketServerTestConnectionWrapper<
    MessageFromClient extends {type: string},
    MessageFromServer extends {type: string},
    Connection extends WebSocketServerConnectionBase<MessageFromClient>,
> implements WebSocketServerConnectionWrapperBase<Connection>
{
    public readonly id: WebSocketConnectionId;
    public readonly connection: Connection;
    private readonly _processContext: ProcessContext;
    private readonly _messageFromClientSchema: Schema<
        WebSocketMessageFromClient<MessageFromClient>
    >;
    private readonly _messageFromServerSchema: Schema<
        WebSocketMessageFromServer<MessageFromServer>
    >;
    private readonly _sessionId: SessionId;
    private readonly _sessionAccountId: AccountId;
    private _isClosed = false;
    private readonly _closeEvent = new EventEmitter();
    private _messages: Array<MessageFromServer> = [];
    private readonly _messageEvent = new EventEmitter<MessageFromServer>();

    constructor({
        id,
        processContext,
        messageFromClientSchema,
        messageFromServerSchema,
        connection,
        sessionId,
        sessionAccountId,
    }: {
        id: WebSocketConnectionId;
        processContext: ProcessContext;
        messageFromClientSchema: Schema<WebSocketMessageFromClient<MessageFromClient>>;
        messageFromServerSchema: Schema<WebSocketMessageFromServer<MessageFromServer>>;
        connection: Connection;
        sessionId: SessionId;
        sessionAccountId: AccountId;
    }) {
        // Can only use test connections in Jest.
        assert(typeof jest !== "undefined");

        this.id = id;
        this.connection = connection;
        this._processContext = processContext;
        this._messageFromClientSchema = messageFromClientSchema;
        this._messageFromServerSchema = messageFromServerSchema;
        this._sessionId = sessionId;
        this._sessionAccountId = sessionAccountId;
    }

    public async handleMessage(message: MessageFromClient): Promise<void> {
        await this._processContext.tracer.withSpan(
            "Received test WebSocket message",
            async (context, span) => {
                // TODO(calebmer): Can we at least give this some kind of TTL in-memory cache??
                const session = await Session.get(context, this._sessionId, this._sessionAccountId);
                if (!session)
                    throw new NotFoundError("Session was revoked after the connection began");

                await context.with(
                    {
                        cache: new CacheContextModule(),
                        auth: new AuthenticatedAuthContextModule(session),
                    },
                    async (context: RequestContext) => {
                        // Thrown errors should be handled by the test. We do not send acknowledgement
                        // messages in test connections.
                        await this.connection.handleMessage(context, message, span);
                    },
                );
            },
        );
    }

    public takeMessages(): Array<MessageFromServer> {
        const messages = this._messages;
        this._messages = [];
        return messages;
    }

    public subscribeToMessages(listener: (message: MessageFromServer) => void) {
        return this._messageEvent.subscribe(listener);
    }

    public isClosed() {
        return this._isClosed;
    }

    public close() {
        if (this._isClosed) return;
        this._isClosed = true;
        this._closeEvent.emit();
    }

    public subscribeToClose(listener: () => void) {
        return this._closeEvent.subscribe(listener);
    }

    public isSoftClosed() {
        return this.isClosed();
    }

    public sendMessage(message: MessageFromServer) {
        this._messages.push(message);
        this._messageEvent.emit(message);
    }

    public dangerouslySendRawMessageEvenWhenSoftClosed(
        context: ProcessContext,
        messageType: string,
        rawMessage: string,
    ) {
        const message = this._messageFromServerSchema.deserialize(JSON.parse(rawMessage));
        if (message.type === "Message") this.sendMessage(message.message);
    }

    public maybeExpire() {
        // Test connections never expire...
    }
}

/**
 * Used to pass a `context` object from our `close()` function call to the
 * event listener which logs a close event.
 */
let contextForCloseEventListener: ProcessContext | null = null;
