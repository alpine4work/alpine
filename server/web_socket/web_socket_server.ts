import {WebSocket, WebSocketPair} from "#server/web_socket/internal/web_socket_pair.js";
import {SessionActorContextModule} from "~/server/helpers/actor_context_module.js";
import {validateTracerEventFlatDataForPropagation} from "~/server/tracer/validate_tracer_event_flat_data.js";
import {Context} from "~/shared/context/context.js";
import {
    ForkActionContextModule,
    ForkActionContextModuleDetachedForker,
    ForkableContextModuleBase,
} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {Interval, createInterval} from "~/shared/helpers/async/interval.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";
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

// Cloudflare allows attaching a `webSocket` to a response object. Our Node.js
// `createStandardizedServer()` implementation knows to look for this property.
//
// https://developers.cloudflare.com/workers/runtime-apis/websockets/use-websockets/
declare global {
    interface ResponseInit {
        webSocket?: globalThis.WebSocket | null;
    }
}

export type WebSocketConnectionProcedures<
    SessionActionContextModules extends {},
    Protocol extends WebSocketProtocolBase,
> = _WebSocketConnectionProcedures<
    SessionActionContextModules,
    WebSocketProtocolProceduresType<Protocol>
>;

type _WebSocketConnectionProcedures<
    SessionActionContextModules extends {},
    Procedures extends {[name: string]: {input: {}; output: {}}},
> = {
    readonly [Name in keyof Procedures]: (
        context: Context<SessionActionContextModules>,
        input: Procedures[Name]["input"],
        span: TracerSpan,
    ) => Promise<Procedures[Name]["output"]>;
};

declare const anySecret: unique symbol;

export interface WebSocketServerConnectionBase<
    ProcessContextModules extends {},
    SessionActionContextModules extends {},
    Protocol extends WebSocketProtocolBase,
> {
    /**
     * Implementation of the procedures defined by the the WebSocket protocol used
     * by this connection.
     */
    // If `Protocol` matches `anySecret` then we consider it to be the `any` type.
    // If `Protocol` is `any` then make the full `procedures` object `any` to
    // simplify some compatibility checks.
    readonly procedures: [Protocol] extends [typeof anySecret]
        ? any
        : WebSocketConnectionProcedures<SessionActionContextModules, Protocol>;

    /**
     * Authorizes that the session has access to the entity we're connected to. We
     * run this function every couple minutes so if the session loses access we
     * eventually shut down the connection.
     */
    authorize(context: Context<SessionActionContextModules>): Promise<void>;

    /**
     * Allow the connection to have some cleanup logic.
     */
    handleClose?(
        context: Context<ProcessContextModules> | Context<SessionActionContextModules>,
    ): void;
}

/**
 * A helper for communicating over WebSockets in a Durable Object. See
 * `WebSocketClient` for the client side of this class.
 */
export class WebSocketServer<
    ProcessContextModules extends {
        process: ProcessContextModule;
        tracer: TracerContextModule;
        fork?: undefined;
    },
    SessionActionContextModules extends {
        process: ProcessContextModule;
        tracer: TracerContextModule;
        actor: SessionActorContextModule;
        fork: ForkActionContextModule;
        [key: string]: ForkableContextModuleBase;
    },
    Protocol extends WebSocketProtocolBase,
    Connection extends WebSocketServerConnectionBase<
        ProcessContextModules,
        SessionActionContextModules,
        Protocol
    >,
> {
    private readonly _processContext: Context<ProcessContextModules>;
    private readonly _protocol: Protocol;
    private readonly _messageFromClientSchema: Schema<WebSocketMessageFromClient<Protocol>>;
    private readonly _messageFromServerSchema: Schema<WebSocketMessageFromServer<Protocol>>;
    private readonly _createConnection: (connection: {
        accountId: AccountId;
        connectionId: WebSocketConnectionId;
        sendEvent: (
            context: Context<ProcessContextModules>,
            event: WebSocketProtocolEventType<Protocol>,
        ) => void;
        sendEventToOthers: (
            context: Context<ProcessContextModules>,
            event: WebSocketProtocolEventType<Protocol>,
        ) => void;
        iterateOtherConnections: () => Iterable<Connection>;
    }) => Connection;

    private readonly _connections = new Map<
        WebSocketConnectionId,
        WebSocketServerConnectionWrapperBase<ProcessContextModules, Connection>
    >();
    private _expirationInterval: Interval | null = null;

    /**
     * Used to pass a `context` object from our `close()` function call to the
     * event listener which logs a close event.
     */
    private readonly _contextForCloseEventListenerRef: {
        current: Context<ProcessContextModules> | Context<SessionActionContextModules> | null;
    } = {current: null};

    constructor(
        processContext: Context<ProcessContextModules>,
        protocol: Protocol,
        createConnection: (connection: {
            accountId: AccountId;
            connectionId: WebSocketConnectionId;
            sendEvent: (
                context: Context<ProcessContextModules>,
                event: WebSocketProtocolEventType<Protocol>,
            ) => void;
            sendEventToOthers: (
                context: Context<ProcessContextModules>,
                event: WebSocketProtocolEventType<Protocol>,
            ) => void;
            iterateOtherConnections: () => Iterable<Connection>;
        }) => Connection,
    ) {
        this._processContext = processContext;
        this._protocol = protocol;
        this._messageFromClientSchema = createWebSocketMessageFromClientSchema(protocol);
        this._messageFromServerSchema = createWebSocketMessageFromServerSchema(protocol);
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
                        connection.maybeExpire(
                            context as Context<ProcessContextModules>,
                            currentTimeMs,
                        );

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
                            this._handleConnectionClose(
                                context as Context<ProcessContextModules>,
                                connection,
                            );
                        }
                    }
                },
            );
        }, webSocketExpirationTimeoutMs / 2);
    }

    /**
     * Upgrade an HTTP request to a WebSocket connection.
     */
    public async upgrade(
        _connectActionContext: Context<SessionActionContextModules>,
        request: Request,
        // NOTE(calebmer): Allow the caller to manually provide a `Response` class in
        // Jest tests. Jest is being weird about setting the `Response` global. This is
        // likely a bug in Jest. When it's fixed we can remove this.
        {responseClassForTest}: {responseClassForTest?: typeof Response} = {},
    ): Promise<Response> {
        if (request.headers.get("upgrade") !== "websocket")
            throw new InvalidArgumentError("Not a WebSocket request");

        const socketPair = new WebSocketPair();
        const clientSocket = socketPair[0];
        const serverSocket = socketPair[1];

        // Only allow a custom `Response` class in Jest tests.
        assert(import.meta.jest || responseClassForTest === undefined);

        const response = new (responseClassForTest ?? Response)(null, {
            status: 101,
            // Cloudflare's WebSocket implementation doesn't fully comply with the
            // TypeScript DOM WebSocket type (e.g. there is no `bufferedAmount` or
            // `binaryType` property) but everything seems to be fine regardless.
            webSocket: clientSocket as any as globalThis.WebSocket,
        });

        const sendEvent = (
            context: Context<ProcessContextModules>,
            event: WebSocketProtocolEventType<Protocol>,
        ) => {
            connection.sendMessage(context, {
                type: "Event",
                event,
            });
        };

        const sendEventToOthers = (
            context: Context<ProcessContextModules>,
            event: WebSocketProtocolEventType<Protocol>,
        ) => {
            this._sendEventToOthers(context, connection.id, event);
        };

        const iterateOtherConnections = (): Iterable<Connection> => {
            return filterMapIterable(this._connections.values(), otherConnection =>
                otherConnection.id !== connection.id && !otherConnection.isSoftClosed()
                    ? otherConnection.connection
                    : null,
            );
        };

        const accountId = _connectActionContext.actor.getAccountId();
        const connectionId = generateId<WebSocketConnectionId>();

        const connectionProcessContext = this._processContext.tracer.withPropagatedData({
            context: {
                accountId,
                webSocketConnectionId: connectionId,
            },
        }) as Context<ProcessContextModules>;

        const connectActionContext = _connectActionContext.tracer.withPropagatedData({
            context: {
                accountId,
                webSocketConnectionId: connectionId,
            },
        }) as Context<SessionActionContextModules>;

        const actualConnection = this._createConnection({
            accountId,
            connectionId,
            sendEvent,
            sendEventToOthers,
            iterateOtherConnections,
        });

        const connection = new WebSocketServerConnectionWrapper<
            ProcessContextModules,
            SessionActionContextModules,
            Protocol,
            Connection
        >({
            id: connectionId,
            processContext: connectionProcessContext,
            connectActionContext,
            socket: serverSocket,
            messageFromClientSchema: this._messageFromClientSchema,
            messageFromServerSchema: this._messageFromServerSchema,
            connection: actualConnection,
            contextForCloseEventListenerRef: this._contextForCloseEventListenerRef,
        });

        assert(!this._connections.has(connection.id));
        this._connections.set(connection.id, connection);

        this._maybeStartExpirationInterval();

        serverSocket.addEventListener("close", () => {
            this._handleConnectionClose(
                // Hopefully this is fired synchronously and we get the context object passed
                // into our `close()` call.
                this._contextForCloseEventListenerRef.current ?? connectionProcessContext,
                connection,
            );
        });

        serverSocket.accept();

        connectActionContext.tracer.log("WebSocket connected", {
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
        context: Context<ProcessContextModules> | Context<SessionActionContextModules>,
        connection: WebSocketServerConnectionWrapperBase<ProcessContextModules, Connection>,
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
    public sendEventToAll(
        context: Context<ProcessContextModules>,
        event: WebSocketProtocolEventType<Protocol>,
    ) {
        const messageType = `Event:${event.type}`;
        context.tracer.withSpanSync(
            `Sending all WebSocket connections message ${messageType}`,
            (context, span) => {
                span.addData({webSocket: {messageType}});

                const serializedMessage = this._messageFromServerSchema.serialize({
                    type: "Event",
                    event,
                });
                const serializedMessageString = JSON.stringify(serializedMessage);

                for (const connection of this._connections.values()) {
                    // Don't send new messages to soft closed connections.
                    if (connection.isSoftClosed()) continue;

                    connection.dangerouslySendRawMessageEvenWhenSoftClosed(
                        context,
                        messageType,
                        serializedMessageString,
                    );
                }
            },
        );
    }

    /**
     * Send a message to connected clients besides the provided connection ID.
     */
    private _sendEventToOthers(
        context: Context<ProcessContextModules>,
        ourConnectionId: WebSocketConnectionId,
        event: WebSocketProtocolEventType<Protocol>,
    ) {
        const messageType = `Event:${event.type}`;
        context.tracer.withSpanSync(
            `Sending all other WebSocket connections message ${messageType}`,
            (context, span) => {
                span.addData({webSocket: {messageType}});

                const serializedMessage = this._messageFromServerSchema.serialize({
                    type: "Event",
                    event,
                });
                const serializedMessageString = JSON.stringify(serializedMessage);

                for (const connection of this._connections.values()) {
                    if (connection.id === ourConnectionId) continue;

                    // Don't send new messages to soft closed connections.
                    if (connection.isSoftClosed()) continue;

                    connection.dangerouslySendRawMessageEvenWhenSoftClosed(
                        context,
                        messageType,
                        serializedMessageString,
                    );
                }
            },
        );
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
    public closeAll(context: Context<ProcessContextModules>) {
        context.tracer.withSpanSync("Closing all WebSocket connections", context => {
            for (const connection of this._connections.values()) {
                connection.close(context, 1001, "Closing all WebSocket connections");

                // NOTE(calebmer): In case the `close` event wasn't fired manually call our
                // event handler. Since I've seen the close event not fire before in response
                // to calling `close()` I'm paranoid and adding a second call here.
                this._handleConnectionClose(context as Context<ProcessContextModules>, connection);
            }
        });
    }

    /**
     * Creates a new test connection for our WebSocket server. Can only be used in
     * Jest unit tests because it does not implement the full WebSocket
     * client/server interface which only works in a trusted environment.
     */
    public async connectForTest(
        _connectActionContext: Context<SessionActionContextModules>,
    ): Promise<
        WebSocketServerTestConnection<
            ProcessContextModules,
            SessionActionContextModules,
            Protocol,
            Connection
        >
    > {
        assert(import.meta.jest);

        const sendEvent = (
            context: Context<ProcessContextModules>,
            event: WebSocketProtocolEventType<Protocol>,
        ) => {
            connection._sendEvent(event);
        };

        const sendEventToOthers = (
            context: Context<ProcessContextModules>,
            event: WebSocketProtocolEventType<Protocol>,
        ) => {
            this._sendEventToOthers(context, connection.id, event);
        };

        const iterateOtherConnections = (): Iterable<Connection> => {
            return filterMapIterable(this._connections.values(), otherConnection =>
                otherConnection.id !== connection.id && !otherConnection.isSoftClosed()
                    ? otherConnection.connection
                    : null,
            );
        };

        const accountId = _connectActionContext.actor.getAccountId();
        const connectionId = generateId<WebSocketConnectionId>();

        const connectionProcessContext = this._processContext.tracer.withPropagatedData({
            context: {
                accountId,
                webSocketConnectionId: connectionId,
            },
        }) as Context<ProcessContextModules>;

        const connectActionContext = _connectActionContext.tracer.withPropagatedData({
            context: {
                accountId,
                webSocketConnectionId: connectionId,
            },
        }) as Context<SessionActionContextModules>;

        const actualConnection = this._createConnection({
            accountId,
            connectionId,
            sendEvent,
            sendEventToOthers,
            iterateOtherConnections,
        });

        // In tests, block establishing the connection on authorization.
        await connectActionContext.tracer.withSpan(
            webSocketConnectionAuthorizationSpanName,
            context => actualConnection.authorize(context as Context<SessionActionContextModules>),
        );

        const connection = new WebSocketServerTestConnectionWrapper({
            id: connectionId,
            actionContext: connectActionContext,
            messageFromClientSchema: this._messageFromClientSchema,
            messageFromServerSchema: this._messageFromServerSchema,
            connection: actualConnection,
        });

        assert(!this._connections.has(connection.id));
        this._connections.set(connection.id, connection);

        this._maybeStartExpirationInterval();

        connection.subscribeToClose(() => {
            this._handleConnectionClose(
                // Hopefully this is fired synchronously and we get the context object passed
                // into our `close()` call.
                this._contextForCloseEventListenerRef.current ?? connectionProcessContext,
                connection,
            );
        });

        return {
            id: connection.id,
            connection: connection.connection,
            procedures: mapObjectValues(
                this._protocol.procedureSchemas,
                (procedureSchema, procedureName) => (input: any) =>
                    connection.executeProcedure(procedureName, input),
            ) as any,
            takeEvents: () => connection.takeEvents(),
            subscribeToEvents: listener => connection.subscribeToEvents(listener),
            authorize: () => connection.authorize(),
            close: () => connection.close(),
        };
    }
}

/**
 * WebSocket server connections are implemented either with a real WebSocket
 * client or a test WebSocket client only available in unit tests.
 */
interface WebSocketServerConnectionWrapperBase<ProcessContextModules extends {}, Connection> {
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
    close(context: Context<{}>, code?: number, reason?: string): void;

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
        context: Context<{tracer: TracerContextModule}>,
        messageType: string,
        message: string,
    ): void;

    /**
     * The WebSocket server will try to occasionally expire connections that have
     * gone offline. When the WebSocket server's expiration check timer triggers it
     * calls this function. Does nothing if the connection is already closed.
     */
    maybeExpire(context: Context<ProcessContextModules>, currentTimeMs: number): void;
}

const webSocketConnectionAuthorizationSpanName = "Authorizing WebSocket connection";

/**
 * A successful WebSocket connection authorization is invalidated after this
 * time period. At this point, we block all message sending and receiving until
 * authorization is revalidated.
 */
const webSocketConnectionAuthorizationInvalidatedMs = 1000 * 60 * 4;

/**
 * After this time period has elapsed since our last WebSocket connection
 * authorization, we re-run authorization to make sure we're still authorized.
 * This value is less than `webSocketConnectionAuthorizationInvalidatedMs` so
 * that we can run authorization in the background without blocking the sending
 * or receiving of realtime messages.
 *
 * In practice, this is the true interval at which we refresh WebSocket
 * authorization.
 *
 * Authorization is refreshed lazily when the connection has activity. If the
 * connection is sitting idle with only ping/pong then we don't run
 * authorization.
 */
const webSocketConnectionAuthorizationRevalidateMs = 1000 * 60 * 3;

class WebSocketServerConnectionWrapper<
    ProcessContextModules extends {
        process: ProcessContextModule;
        tracer: TracerContextModule;
        fork?: undefined;
    },
    SessionActionContextModules extends {
        process: ProcessContextModule;
        tracer: TracerContextModule;
        actor: SessionActorContextModule;
        fork: ForkActionContextModule;
        [key: string]: ForkableContextModuleBase;
    },
    Protocol extends WebSocketProtocolBase,
    Connection extends WebSocketServerConnectionBase<
        ProcessContextModules,
        SessionActionContextModules,
        Protocol
    >,
> implements WebSocketServerConnectionWrapperBase<ProcessContextModules, Connection>
{
    public readonly id: WebSocketConnectionId;
    private readonly _processContext: Context<ProcessContextModules>;
    private readonly _socket: WebSocket;
    private readonly _messageFromClientSchema: Schema<WebSocketMessageFromClient<Protocol>>;
    private readonly _messageFromServerSchema: Schema<WebSocketMessageFromServer<Protocol>>;
    public readonly connection: Connection;
    private readonly _detachedForker: ForkActionContextModuleDetachedForker<SessionActionContextModules>;
    private readonly _contextForCloseEventListenerRef: {
        current: Context<ProcessContextModules> | Context<SessionActionContextModules> | null;
    };
    private _lastMessageTime: number = Date.now();

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

    private _authorizationState: {
        startTime: number;
        promise: Promise<void> & {
            // Allow us to synchronously check whether the authorization promise has
            // been fulfilled.
            status?: "fulfilled";
        };
        next: {
            startTime: number;
            promise: Promise<void>;
        } | null;
    } | null = null;

    constructor({
        id,
        processContext,
        connectActionContext,
        socket,
        messageFromClientSchema,
        messageFromServerSchema,
        connection,
        contextForCloseEventListenerRef,
    }: {
        id: WebSocketConnectionId;
        processContext: Context<ProcessContextModules>;
        connectActionContext: Context<SessionActionContextModules>;
        socket: WebSocket;
        messageFromClientSchema: Schema<WebSocketMessageFromClient<Protocol>>;
        messageFromServerSchema: Schema<WebSocketMessageFromServer<Protocol>>;
        connection: Connection;
        contextForCloseEventListenerRef: {
            current: Context<ProcessContextModules> | Context<SessionActionContextModules> | null;
        };
    }) {
        this.id = id;
        this._processContext = processContext;
        this._socket = socket;
        this._messageFromClientSchema = messageFromClientSchema;
        this._messageFromServerSchema = messageFromServerSchema;
        this.connection = connection;
        this._detachedForker = connectActionContext.fork.getDetachedForker();
        this._contextForCloseEventListenerRef = contextForCloseEventListenerRef;

        void this._authorize(connectActionContext);

        this._socket.addEventListener("message", event => {
            this._processContext.process.waitUntil(async () => {
                this._lastMessageTime = Date.now();

                let message: WebSocketMessageFromClient<Protocol>;
                try {
                    if (event.data instanceof ArrayBuffer)
                        throw new InvalidArgumentError("Unexpected binary WebSocket message");

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
                if (!message.tracerContext) {
                    ({span, finishSpan} = this._processContext.tracer
                        .getRoot()
                        .startSpan(spanName));
                } else {
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
                }

                await this._detachedForker.withForkFromCustomSpan(
                    {span, finishSpan},
                    async (context, span) => {
                        try {
                            const spanMessageType =
                                message.type === "ProcedureRequest"
                                    ? `ProcedureRequest:${message.input.type}`
                                    : message.type;

                            span.appendName(` ${spanMessageType}`);
                            span.addData({
                                webSocket: {
                                    connectionId: this.id,
                                    messageType: spanMessageType,
                                },
                            });

                            // If the client soft closed our connection we won't accept new procedures. We
                            // still process ping/pong messages since that tells us the connection is
                            // still alive.
                            //
                            // It is important that this comes before any `await`s like our
                            // `await Session.get()` below so we don't have any race conditions between the
                            // `SoftCloseWhileWaitingForProcedureResponses` message and other messages.
                            if (this._isSoftClosed && message.type === "ProcedureRequest")
                                throw new FailedPreconditionError(
                                    "WebSocket connection can not process new procedures when soft closed",
                                );

                            switch (message.type) {
                                // In response to a ping event, we want to send "pong" to the client so it
                                // knows we are alive and didn't silently disconnect.
                                //
                                // We want to skip authorization when sending the `Pong` message. We should
                                // only authorize if the connection is actively being used.
                                case "Ping": {
                                    const messageType = "Pong" as const;

                                    this._dangerouslySendRawMessageEvenWhenSoftClosedWithoutAuthorization(
                                        context,
                                        messageType,
                                        JSON.stringify(
                                            this._messageFromServerSchema.serialize({
                                                type: messageType,
                                            }),
                                        ),
                                    );
                                    break;
                                }
                                case "ProcedureRequest": {
                                    // Make sure we are authorized before processing a procedure from the
                                    // client...
                                    await this._authorize(context);

                                    const {
                                        input: {type, ...input},
                                    } = message;

                                    try {
                                        const output = await this.connection.procedures[type](
                                            context,
                                            input,
                                            span,
                                        );

                                        this.sendMessage(context, {
                                            type: "ProcedureResponse",
                                            requestId: message.requestId,
                                            result: {
                                                ok: true,
                                                output: {type, ...output},
                                            },
                                        });
                                    } catch (error) {
                                        span.addException(error);

                                        this.sendMessage(context, {
                                            type: "ProcedureResponse",
                                            requestId: message.requestId,
                                            result: {
                                                ok: false,
                                                outputType: type,
                                                error,
                                            },
                                        });
                                    }
                                    break;
                                }
                                case "SoftCloseWhileWaitingForProcedureResponses": {
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

    public maybeExpire(context: Context<ProcessContextModules>, currentTimeMs: number) {
        // If our socket is already closed then we don't need to expire.
        if (this.isClosed()) return;

        // If we haven't gotten a message from the client in a while, close it. Maybe
        // the client's power went out and it silently went away without telling us.
        if (currentTimeMs - this._lastMessageTime >= webSocketExpirationTimeoutMs) {
            this.close(context, 1002, "WebSocket connection expired due to inactivity");
            return;
        }
    }

    private _authorize(
        context: Context<ProcessContextModules> | Context<SessionActionContextModules>,
    ) {
        const currentTime = Date.now();
        const oldAuthorizationPromise = this._authorizationState?.promise;

        // If our authorization promise is invalidated and we have a new promise at the
        // ready, substitute it in.
        if (
            this._authorizationState &&
            currentTime - this._authorizationState.startTime >
                webSocketConnectionAuthorizationInvalidatedMs &&
            this._authorizationState.next
        ) {
            this._authorizationState = {
                startTime: this._authorizationState.next.startTime,
                promise: this._authorizationState.next.promise,
                next: null,
            };
        }

        // If:
        //
        // 1. This connection hasn't authorized yet; OR
        // 2. We have an authorization promise that's invalidated and have not started
        //    a new authorization promise in the background; OR
        // 3. We had started a new authorization promise in the background but enough
        //    time has passed that the background authorization promise has become
        //    invalidated.
        //
        // We reach case 3 if the branch above sets the new authorization promise but
        // the new authorization promise is also invalidated.
        if (
            this._authorizationState === null ||
            currentTime - this._authorizationState.startTime >
                webSocketConnectionAuthorizationInvalidatedMs
        ) {
            // If we have an action context then use that to authorize. Otherwise we have a
            // process context and need to create an action context fork.
            //
            // Only start a new authorization request if the last one was successful.
            const authorizationPromise = (
                this._authorizationState?.promise ?? Promise.resolve()
            ).then(() =>
                context.fork
                    ? (context as Context<SessionActionContextModules>).tracer.withSpan(
                          webSocketConnectionAuthorizationSpanName,
                          context =>
                              this.connection.authorize(
                                  context as Context<SessionActionContextModules>,
                              ),
                      )
                    : this._detachedForker.withFork(
                          webSocketConnectionAuthorizationSpanName,
                          context => this.connection.authorize(context),
                      ),
            );

            this._authorizationState = {
                startTime: Date.now(),
                promise: authorizationPromise,
                next: null,
            };
        }

        // If we've passed our revalidation timeout then re-run authorization in the
        // background. Once our current authorization promise expires we can switch to
        // this one.
        if (
            currentTime - this._authorizationState.startTime >
                webSocketConnectionAuthorizationRevalidateMs &&
            !this._authorizationState.next
        ) {
            // If we have an action context then use that to authorize. Otherwise we have a
            // process context and need to create an action context fork.
            //
            // Only start a new authorization request if the last one was successful.
            const authorizationPromise = this._authorizationState.promise.then(() =>
                context.fork
                    ? (context as Context<SessionActionContextModules>).tracer.withSpan(
                          webSocketConnectionAuthorizationSpanName,
                          context =>
                              this.connection.authorize(
                                  context as Context<SessionActionContextModules>,
                              ),
                      )
                    : this._detachedForker.withFork(
                          webSocketConnectionAuthorizationSpanName,
                          context => this.connection.authorize(context),
                      ),
            );

            context.process.waitUntil(authorizationPromise);

            this._authorizationState.next = {
                startTime: currentTime,
                promise: authorizationPromise,
            };
        }

        const newAuthorizationPromise = this._authorizationState.promise;

        // If we have a new authorization promise then register callbacks for when
        // it finishes...
        if (oldAuthorizationPromise !== newAuthorizationPromise) {
            context.process.waitUntil(
                newAuthorizationPromise.then(
                    // Allow checking that the promise is resolved synchronously.
                    () => {
                        newAuthorizationPromise.status = "fulfilled";
                    },
                    // If authorization failed then we should close the WebSocket connection with an
                    // error. This tells clients they shouldn't retry connecting to the WebSocket.
                    error => {
                        const messageType = "ClosingWithError" as const;

                        this._dangerouslySendRawMessageEvenWhenSoftClosedWithoutAuthorization(
                            context,
                            messageType,
                            JSON.stringify(
                                this._messageFromServerSchema.serialize({
                                    type: messageType,
                                    error,
                                }),
                            ),
                        );

                        this.close(context);
                    },
                ),
            );
        }

        return this._authorizationState.promise;
    }

    /**
     * Send a message over our WebSocket connection. Throws an error if the
     * connection is closed!
     */
    public sendMessage(
        context: Context<ProcessContextModules> | Context<SessionActionContextModules>,
        message: WebSocketMessageFromServer<Protocol>,
    ) {
        // Do not send events to a soft closed WebSocket. A soft closed WebSocket is
        // in the process of cleaning up and only expects acknowledgements for
        // previously sent procedures and pong messages.
        //
        // Once the client receives all of its procedure responses then it closes
        // for real.
        if (this._isSoftClosed && message.type === "Event") return;

        const serializedMessage = this._messageFromServerSchema.serialize(message);

        this.dangerouslySendRawMessageEvenWhenSoftClosed(
            context,
            message.type === "ProcedureResponse"
                ? `ProcedureResponse:${
                      message.result.ok ? message.result.output.type : message.result.outputType
                  }`
                : message.type === "Event"
                ? `Event:${message.event.type}`
                : message.type,
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
        context: Context<ProcessContextModules> | Context<SessionActionContextModules>,
        messageType: string,
        message: string,
    ) {
        const authorizationPromise = this._authorize(context);

        if (authorizationPromise.status === "fulfilled") {
            this._dangerouslySendRawMessageEvenWhenSoftClosedWithoutAuthorization(
                context,
                messageType,
                message,
            );
        } else {
            context.process.waitUntil(
                authorizationPromise.then(() => {
                    this._dangerouslySendRawMessageEvenWhenSoftClosedWithoutAuthorization(
                        context,
                        messageType,
                        message,
                    );
                }),
            );
        }
    }

    private _dangerouslySendRawMessageEvenWhenSoftClosedWithoutAuthorization(
        context: Context<{tracer: TracerContextModule}>,
        messageType: string,
        message: string,
    ) {
        // Don't send messages to a closed WebSocket. The WebSocket may not have been
        // cleaned up yet because it is closing. We will definitely cleanup the
        // WebSocket on our expiration pass if missed the close event.
        if (this.isClosed()) {
            return;
        }

        this._socket.send(message);

        context.tracer.log(`Sent WebSocket message ${messageType}`, {
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
    public close(
        context: Context<ProcessContextModules> | Context<SessionActionContextModules>,
        code?: number,
        reason?: string,
    ) {
        // WebSocket is already closed.
        if (this.isClosed()) return;

        const previousContextForCloseEventListener = this._contextForCloseEventListenerRef.current;
        this._contextForCloseEventListenerRef.current = context;
        try {
            this._socket.close(code, reason);
        } finally {
            this._contextForCloseEventListenerRef.current = previousContextForCloseEventListener;
        }
    }
}

export type WebSocketServerTestConnectionProcedures<
    Procedures extends {[name: string]: {input: {}; output: {}}},
> = {
    readonly [Name in keyof Procedures & string]: (
        input: Procedures[Name]["input"],
    ) => Promise<Procedures[Name]["output"]>;
};

/**
 * A connection object to be used for testing our WebSocket server.
 */
export interface WebSocketServerTestConnection<
    ProcessContextModules extends {},
    SessionActionContextModules extends {},
    Protocol extends WebSocketProtocolBase,
    Connection extends WebSocketServerConnectionBase<
        ProcessContextModules,
        SessionActionContextModules,
        Protocol
    >,
> {
    readonly id: WebSocketConnectionId;
    readonly connection: Connection;

    /**
     * Execute a procedure against the WebSocket connection.
     */
    readonly procedures: WebSocketServerTestConnectionProcedures<
        WebSocketProtocolProceduresType<Protocol>
    >;

    /**
     * Get all events sent by the WebSocket server to the client since the last
     * `takeEvents()` call. Calling this function will clear the array so if
     * you call it immediately it will be empty.
     *
     * If you have a subscriber with `subscribeToEvents()` then messages observed
     * by that function will still show up in `takeEvents()`.
     *
     * This function allows you to pull new messages, `subscribeToEvents()` lets
     * the server push new messages to you.
     */
    takeEvents(): Array<WebSocketProtocolEventType<Protocol>>;

    /**
     * Subscribe to events from the server as they are published. Returns a
     * function that lets you unsubscribe.
     */
    subscribeToEvents(
        listener: (message: WebSocketProtocolEventType<Protocol>) => void,
    ): () => void;

    /**
     * Run the connection's authorization procedure to reauthorize. If
     * authorization fails then the connection will be closed.
     */
    authorize(): Promise<void>;

    /**
     * Close the connection. Does nothing if the connection is already closed.
     */
    close(): void;
}

let afterNextCallbacksForTest: Array<() => Promise<void>> | null = import.meta.jest ? [] : null;

if (import.meta.jest) {
    afterEach(async () => {
        const callbacks = assertExists(afterNextCallbacksForTest);
        afterNextCallbacksForTest = [];

        await runAllPromises(callbacks.map(callback => callback()));
    });
}

class WebSocketServerTestConnectionWrapper<
    ProcessContextModules extends {},
    SessionActionContextModules extends {
        process: ProcessContextModule;
        tracer: TracerContextModule;
        fork: ForkActionContextModule;
    },
    Protocol extends WebSocketProtocolBase,
    Connection extends WebSocketServerConnectionBase<
        ProcessContextModules,
        SessionActionContextModules,
        Protocol
    >,
> implements WebSocketServerConnectionWrapperBase<ProcessContextModules, Connection>
{
    public readonly id: WebSocketConnectionId;
    public readonly connection: Connection;
    private readonly _actionContext: Context<SessionActionContextModules>;
    private readonly _messageFromClientSchema: Schema<WebSocketMessageFromClient<Protocol>>;
    private readonly _messageFromServerSchema: Schema<WebSocketMessageFromServer<Protocol>>;
    private _isClosed = false;
    private readonly _closeEvent = new EventEmitter();
    private _bufferedEvents: Array<WebSocketProtocolEventType<Protocol>> = [];
    private readonly _events = new EventEmitter<WebSocketProtocolEventType<Protocol>>();

    constructor({
        id,
        actionContext,
        messageFromClientSchema,
        messageFromServerSchema,
        connection,
    }: {
        id: WebSocketConnectionId;
        actionContext: Context<SessionActionContextModules>;
        messageFromClientSchema: Schema<WebSocketMessageFromClient<Protocol>>;
        messageFromServerSchema: Schema<WebSocketMessageFromServer<Protocol>>;
        connection: Connection;
    }) {
        // Can only use test connections in Jest.
        assert(import.meta.jest);

        this.id = id;
        this.connection = connection;
        this._actionContext = actionContext;
        this._messageFromClientSchema = messageFromClientSchema;
        this._messageFromServerSchema = messageFromServerSchema;

        // In tests, authorize every connection after the current test completes to
        // make sure we didn't lose access while the test was executing.
        assertExists(afterNextCallbacksForTest).push(() =>
            this._actionContext.fork.withFork(webSocketConnectionAuthorizationSpanName, context =>
                this.connection.authorize(context),
            ),
        );
    }

    public async executeProcedure<
        Name extends keyof WebSocketProtocolProceduresType<Protocol> & string,
    >(
        name: Name,
        input: WebSocketProtocolProceduresType<Protocol>[Name]["input"],
    ): Promise<WebSocketProtocolProceduresType<Protocol>[Name]["output"]> {
        const output = await this._actionContext.fork.withFork(
            "Received test WebSocket message",
            async (context, span) => {
                // Thrown errors should be handled by the test. We do not send acknowledgement
                // messages in test connections.
                return this.connection.procedures[name](context, input, span);
            },
        );

        return output as any;
    }

    public takeEvents(): Array<WebSocketProtocolEventType<Protocol>> {
        const messages = this._bufferedEvents;
        this._bufferedEvents = [];
        return messages;
    }

    public subscribeToEvents(listener: (event: WebSocketProtocolEventType<Protocol>) => void) {
        return this._events.subscribe(listener);
    }

    public authorize() {
        return this._actionContext.fork
            .withFork(webSocketConnectionAuthorizationSpanName, context =>
                this.connection.authorize(context),
            )
            .catch(error => {
                this.close();
                throw error;
            });
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

    // Public so it can be called from `connectForTest()` but should not be called
    // outside of this file.
    public _sendEvent(message: WebSocketProtocolEventType<Protocol>) {
        this._bufferedEvents.push(message);
        this._events.emit(message);
    }

    public dangerouslySendRawMessageEvenWhenSoftClosed(
        context: Context<{tracer: TracerContextModule}>,
        messageType: string,
        rawMessage: string,
    ) {
        const message = this._messageFromServerSchema.deserialize(JSON.parse(rawMessage));
        if (message.type === "Event") this._sendEvent(message.event);
    }

    public maybeExpire() {
        // Test connections never expire...
    }
}
