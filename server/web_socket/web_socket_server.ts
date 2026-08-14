import {WebSocket, WebSocketPair} from "#server/web_socket/internal/web_socket_pair.js";
import {
    ActorContextModule,
    SessionActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {validateTracerEventFlatDataForPropagation} from "~/server/tracer/validate_tracer_event_flat_data.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {
    ForkActionContextModule,
    ForkActionContextModuleDetachedForker,
    ForkableContextModuleBase,
} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    CancelledError,
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    UnavailableError,
    UnimplementedError,
} from "~/shared/error/error.open_source.js";
import {isSystemError} from "~/shared/error/is_system_error_code.open_source.js";
import {Interval, createInterval} from "~/shared/helpers/async/interval.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {voidSafeFloatingPromise} from "~/shared/helpers/async/void_safe_floating_promise.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.open_source.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";
import {generateServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";
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
    ActionContextModules extends {},
    Protocol extends WebSocketProtocolBase,
> = _WebSocketConnectionProcedures<ActionContextModules, WebSocketProtocolProceduresType<Protocol>>;

type _WebSocketConnectionProcedures<
    ActionContextModules extends {},
    Procedures extends {[name: string]: {input: {}; output: {}}},
> = {
    readonly [Name in keyof Procedures]: (
        context: Context<ActionContextModules>,
        input: Procedures[Name]["input"],
        span: TracerSpan,
    ) => Promise<Procedures[Name]["output"]>;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare const anySecret: unique symbol;

export interface WebSocketServerConnectionBase<
    ProcessContextModules extends {},
    ActionContextModules extends {},
    Protocol extends WebSocketProtocolBase,
    EventStub,
> {
    /**
     * Implementation of the procedures defined by the the WebSocket protocol used by
     * this connection.
     */
    // If `Protocol` matches `anySecret` then we consider it to be the `any` type. If
    // `Protocol` is `any` then make the full `procedures` object `any` to simplify
    // some compatibility checks.
    readonly procedures: [Protocol] extends [typeof anySecret]
        ? any
        : WebSocketConnectionProcedures<ActionContextModules, Protocol>;

    /**
     * Authorizes that the session has access to the entity we're connected to. We run
     * this function every couple minutes so if the session loses access we eventually
     * shut down the connection.
     */
    authorize(context: Context<ActionContextModules>): Promise<void>;

    /**
     * Converts an event stub into the actual event we'll send to clients. This is
     * important for permissions as it allows us to perform any data loading we might
     * need with the connection account's access level.
     */
    transformEvent(
        context: Context<ActionContextModules>,
        eventStub: EventStub,
    ): MaybePromise<WebSocketProtocolEventType<Protocol>>;

    /**
     * Allow the connection to have some cleanup logic.
     */
    handleClose?(
        context: Context<ProcessContextModules> | Context<ActionContextModules>,
    ): MaybePromise<void>;
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
    ActionContextModules extends {
        process: ProcessContextModule;
        tracer: TracerContextModule;
        actor: ActorContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        fork: ForkActionContextModule;
        [key: string]: ForkableContextModuleBase;
    },
    Protocol extends WebSocketProtocolBase,
    EventStub,
    Connection extends WebSocketServerConnectionBase<
        ProcessContextModules,
        ActionContextModules,
        Protocol,
        EventStub
    >,
> {
    private readonly _processContext: Context<ProcessContextModules>;
    private readonly _protocol: Protocol;
    private readonly _messageFromClientSchema: Schema<WebSocketMessageFromClient<Protocol>>;
    private readonly _messageFromServerSchema: Schema<WebSocketMessageFromServer<Protocol>>;
    private readonly _createConnection: (connection: {
        accountId: AccountId;
        connectionId: WebSocketConnectionId;
        searchParams: URLSearchParams;
        sendEvent: (
            context: Context<ProcessContextModules>,
            event: EventStub,
        ) => SafeFloatingPromise<void>;
        sendEventToAllAndWaitForOne: (
            context: Context<ProcessContextModules>,
            event: EventStub,
        ) => Promise<void>;
        sendEventToOthers: (context: Context<ProcessContextModules>, event: EventStub) => void;
        iterateOtherConnections: () => Iterable<Connection>;
        closeWithError: (context: Context<ProcessContextModules>, error: unknown) => void;
        resetAuthorizationTimer: (context: Context<ProcessContextModules>) => void;
    }) => Connection;

    private readonly _connections = new Map<
        WebSocketConnectionId,
        WebSocketServerConnectionWrapperBase<
            ProcessContextModules,
            ActionContextModules,
            EventStub,
            Connection
        >
    >();
    private _expirationInterval: Interval | null = null;

    private _isClosed = false;

    /**
     * Used to pass a `context` object from our `close()` function call to the event
     * listener which logs a close event.
     */
    private readonly _contextForCloseEventListenerRef: {
        current: Context<ProcessContextModules> | Context<ActionContextModules> | null;
    } = {current: null};

    constructor(
        processContext: Context<ProcessContextModules>,
        protocol: Protocol,
        createConnection: (connection: {
            accountId: AccountId;
            connectionId: WebSocketConnectionId;
            searchParams: URLSearchParams;
            sendEvent: (
                context: Context<ProcessContextModules>,
                event: EventStub,
            ) => SafeFloatingPromise<void>;
            sendEventToAllAndWaitForOne: (
                context: Context<ProcessContextModules>,
                event: EventStub,
            ) => Promise<void>;
            sendEventToOthers: (context: Context<ProcessContextModules>, event: EventStub) => void;
            iterateOtherConnections: () => Iterable<Connection>;
            closeWithError: (context: Context<ProcessContextModules>, error: unknown) => void;
            resetAuthorizationTimer: (context: Context<ProcessContextModules>) => void;
        }) => Connection,
    ) {
        this._processContext = processContext;
        this._protocol = protocol;
        this._messageFromClientSchema = createWebSocketMessageFromClientSchema(protocol);
        this._messageFromServerSchema = createWebSocketMessageFromServerSchema(protocol);
        this._createConnection = createConnection;
    }

    private _maybeStartExpirationInterval() {
        // When we get our first connection, start an interval to expire sockets we haven't
        // received a message from in a while.
        //
        // We need to occasionally send a heartbeat to our clients. If the power goes out
        // we'll have a connection that never closes itself.
        if (this._connections.size === 0 || this._expirationInterval !== null) return;

        let currentTimeMs = Date.now();

        // TODO(calebmer): Implement this with durable object alarms so the time works
        // correctly.
        this._expirationInterval = createInterval(() => {
            // This is a workaround for Cloudflare `Date.now()` always returning the same time
            // for a given request. Whenever our interval runs, increment the time by the
            // interval time. https://developers.cloudflare.com/workers/learning/security-model
            currentTimeMs += webSocketExpirationTimeoutMs / 2;

            void this._processContext.tracer.withSpan(
                "Expiring idle WebSocket connections",
                async (context, span) => {
                    // Don't send this span if a connection wasn't closed. If a connection is closed
                    // then we'll send a "close" event which references the parent span. If a
                    // connection is not closed then this span will have no references.
                    span.setWillNotSendIfNotReferenced(true);

                    for (const connection of this._connections.values()) {
                        connection.maybeExpire(
                            context as Context<ProcessContextModules>,
                            currentTimeMs,
                        );

                        // In case the `close` event hasn't fired yet (maybe the connection is in the
                        // process of closing), look for closed connections in our expiration interval loop
                        // and remove them from our connection set.
                        //
                        // NOTE(calebmer, 2022-12-27): I'm observing the `close` event not firing after
                        // `serverSocket.close()` and I'm not sure whether it is a bug or not.
                        //
                        // NOTE(calebmer, 2023-02-23): I think what's happening is the WebSocket moves into
                        // the closing state (so `isClosed()` returns true) but it hasn't fully closed yet
                        // so the `close` event doesn't fire. We could clean the code up a bit with this
                        // knowledge if it's true.
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
        originalConnectActionContext: Context<
            ActionContextModules & {actor: SessionActorContextModule}
        >,
        request: Request,
        // NOTE(calebmer): Allow the caller to manually provide a `Response` class in Jest
        // tests. Jest is being weird about setting the `Response` global. This is likely a
        // bug in Jest. When it's fixed we can remove this.
        {responseClassForTest}: {responseClassForTest?: typeof Response} = {},
    ): Promise<Response> {
        if (this._isClosed)
            throw new UnavailableError("WebSocket server is closed, not accepting new connections");

        if (request.headers.get("upgrade") !== "websocket")
            throw new InvalidArgumentError("Not a WebSocket request");

        const socketPair = new WebSocketPair();
        const clientSocket = socketPair[0];
        const serverSocket = socketPair[1];

        // Only allow a custom `Response` class in Jest tests.
        assert(import.meta.jest || responseClassForTest === undefined);

        const response = new (responseClassForTest ?? Response)(null, {
            status: 101,
            // Cloudflare's WebSocket implementation doesn't fully comply with the TypeScript
            // DOM WebSocket type (e.g. there is no `bufferedAmount` or `binaryType` property)
            // but everything seems to be fine regardless.
            webSocket: clientSocket as any as globalThis.WebSocket,
        });

        const accountId = originalConnectActionContext.actor.getAccountId();
        const connectionId = generateId<WebSocketConnectionId>();

        const connectionProcessContext = this._processContext.tracer.withPropagatedData({
            context: {
                accountId,
                webSocketConnectionId: connectionId,
            },
        }) as Context<ProcessContextModules>;

        const connectActionContext = originalConnectActionContext.tracer.withPropagatedData({
            context: {
                accountId,
                webSocketConnectionId: connectionId,
            },
        }) as Context<ActionContextModules & {actor: SessionActorContextModule}>;

        const actualConnection = this._createConnection({
            accountId,
            connectionId,
            searchParams: new URL(request.url).searchParams,
            sendEvent: (context, event) => {
                return connection.sendEvent(context, event);
            },
            sendEventToAllAndWaitForOne: (context, event) => {
                return this.sendEventToAllAndWaitForOne(context, event, connection.id);
            },
            sendEventToOthers: (context, event) => {
                this._sendEventToOthers(context, connection.id, event);
            },
            iterateOtherConnections: () => {
                return filterMapIterable(this._connections.values(), otherConnection =>
                    otherConnection.id !== connection.id && !otherConnection.isSoftClosed()
                        ? otherConnection.connection
                        : undefined,
                );
            },
            closeWithError: (context, error) => {
                connection.closeWithError(context, error);
            },
            resetAuthorizationTimer: context => {
                connection.resetAuthorizationTimer(context);
            },
        });

        const connection = new WebSocketServerConnectionWrapper<
            ProcessContextModules,
            ActionContextModules,
            Protocol,
            EventStub,
            Connection
        >({
            id: connectionId,
            accountId,
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
                // Hopefully this is fired synchronously and we get the context object passed into
                // our `close()` call.
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
     * Idempotent since we've sometimes observed the WebSocket `close` event not firing
     * so we call this function multiple times when a socket is closing.
     */
    private _handleConnectionClose(
        context: Context<ProcessContextModules> | Context<ActionContextModules>,
        connection: WebSocketServerConnectionWrapperBase<
            ProcessContextModules,
            ActionContextModules,
            EventStub,
            Connection
        >,
    ) {
        const existingConnection = this._connections.get(connection.id);
        if (existingConnection && existingConnection === connection) {
            this._connections.delete(connection.id);

            context.process.waitUntil(async () => {
                const {span, finishSpan} = context.tracer.startSpan("Close WebSocket connection");
                span.addData({
                    webSocket: {
                        connectionId: connection.id,
                    },
                });
                try {
                    await connection.connection.handleClose?.(context);
                    finishSpan();
                } catch (error) {
                    // Don't re-throw error. Adding it to the span is enough. We don't need it to also
                    // be logged as an uncaught exception.
                    span.addException(error);
                    finishSpan();
                }
            });
        }

        // When we are out of connections, clear our interval.
        if (this._connections.size === 0 && this._expirationInterval !== null) {
            this._expirationInterval.clear();
            this._expirationInterval = null;
        }
    }

    /**
     * Does this server have any connected clients?
     */
    public hasConnections(): boolean {
        return this._connections.size > 0;
    }

    /**
     * Send a message to all connected clients.
     */
    public sendEventToAll(context: Context<ProcessContextModules>, eventStub: EventStub) {
        for (const connection of this._connections.values()) {
            connection.sendEvent(context, eventStub);
        }
    }

    /**
     * Send a message to all connected clients and wait for the events to send.
     */
    public async sendEventToAllAndWait(
        context: Context<ProcessContextModules>,
        eventStub: EventStub,
    ) {
        await runAllPromises(
            mapIterable(this._connections.values(), connection =>
                connection.sendEvent(context, eventStub),
            ),
        );
    }

    /**
     * Send a message to all connected clients and wait for one selected connection's
     * event to send. Other connections remain fire-and-forget.
     */
    public async sendEventToAllAndWaitForOne(
        context: Context<ProcessContextModules>,
        eventStub: EventStub,
        connectionId: WebSocketConnectionId,
    ): Promise<void> {
        let selectedSend: SafeFloatingPromise<void> | null = null;
        for (const connection of this._connections.values()) {
            const send = connection.sendEvent(context, eventStub);
            if (connection.id === connectionId) selectedSend = send;
        }
        if (selectedSend !== null) await selectedSend;
    }

    /**
     * Send a message to connected clients besides the provided connection ID.
     */
    private _sendEventToOthers(
        context: Context<ProcessContextModules>,
        ourConnectionId: WebSocketConnectionId,
        eventStub: EventStub,
    ) {
        for (const connection of this._connections.values()) {
            if (connection.id === ourConnectionId) continue;
            connection.sendEvent(context, eventStub);
        }
    }

    /**
     * Iterate through all connected clients.
     */
    public iterateAllConnections() {
        return filterMapIterable(this._connections.values(), connection =>
            !connection.isSoftClosed() ? connection.connection : undefined,
        );
    }

    /**
     * Close all connected clients.
     *
     * Closes the server as well so that you can't make new WebSocket connections.
     *
     * This is a hard shutdown. We do not keep connections open until procedure
     * requests finish. If you want to perform a graceful shutdown you should use
     * `softCloseAll()` which keeps connections open until procedures finish while
     * still instructing clients to reconnect.
     */
    public closeAll(context: Context<ProcessContextModules>) {
        this._isClosed = true;

        context.tracer.withSpanSync("Closing all WebSocket connections", context => {
            for (const connection of this._connections.values()) {
                connection.close(context as Context<ProcessContextModules>, 1001);

                // NOTE(calebmer): In case the `close` event wasn't fired manually call our event
                // handler. Since I've seen the close event not fire before in response to calling
                // `close()` I'm paranoid and adding a second call here.
                this._handleConnectionClose(context as Context<ProcessContextModules>, connection);
            }
        });
    }

    /**
     * Sends all connected clients an error message then closes them.
     *
     * Closes the server as well so that you can't make new WebSocket connections.
     *
     * This is a hard shutdown. We do not keep connections open until procedure
     * requests finish. If you want to perform a graceful shutdown you should use
     * `softCloseAll()` which keeps connections open until procedures finish while
     * still instructing clients to reconnect.
     */
    public closeAllWithError(context: Context<ProcessContextModules>, error: unknown) {
        this._isClosed = true;

        context.tracer.withSpanSync("Closing all WebSocket connections", context => {
            for (const connection of this._connections.values()) {
                connection.closeWithError(context as Context<ProcessContextModules>, error);

                // NOTE(calebmer): In case the `close` event wasn't fired manually call our event
                // handler. Since I've seen the close event not fire before in response to calling
                // `close()` I'm paranoid and adding a second call here.
                this._handleConnectionClose(context as Context<ProcessContextModules>, connection);
            }
        });
    }

    /**
     * Soft close all connected clients.
     *
     * Closes the server as well so that you can't make new WebSocket connections.
     */
    // TODO(calebmer): This is used by our Node.js WebSocket server implementation
    // during graceful shutdowns. I'd like for it to be used during a Durable Object
    // shutdown due to a deploy too. It's unclear to me how Durable Object deploys work
    // and if they're naturally graceful.
    public softCloseAll(context: Context<ProcessContextModules>): Promise<void> {
        this._isClosed = true;

        return context.tracer.withSpan("Soft closing all WebSocket connections", async context => {
            await runAllPromises(
                mapIterable(this._connections.values(), connection =>
                    connection.softClose(context as Context<ProcessContextModules>),
                ),
            );
        });
    }

    /**
     * Creates a new test connection for our WebSocket server. Can only be used in Jest
     * unit tests because it does not implement the full WebSocket client/server
     * interface which only works in a trusted environment.
     */
    public async connectForTest(
        originalConnectActionContext: Context<
            ActionContextModules & {actor: SessionActorContextModule}
        >,
        {searchParams}: {searchParams?: URLSearchParams} = {},
    ): Promise<
        WebSocketServerTestConnection<
            ProcessContextModules,
            ActionContextModules,
            Protocol,
            EventStub,
            Connection
        >
    > {
        assert(import.meta.jest);

        const accountId = originalConnectActionContext.actor.getAccountId();
        const connectionId = generateId<WebSocketConnectionId>();

        const connectionProcessContext = this._processContext.tracer.withPropagatedData({
            context: {
                accountId,
                webSocketConnectionId: connectionId,
            },
        }) as Context<ProcessContextModules>;

        const connectActionContext = originalConnectActionContext.tracer.withPropagatedData({
            context: {
                accountId,
                webSocketConnectionId: connectionId,
            },
        }) as Context<ActionContextModules & {actor: SessionActorContextModule}>;

        const actualConnection = this._createConnection({
            accountId,
            connectionId,
            searchParams: searchParams ?? new URLSearchParams(),
            sendEvent: (context, event) => {
                return connection.sendEvent(context, event);
            },
            sendEventToAllAndWaitForOne: (context, event) => {
                return this.sendEventToAllAndWaitForOne(context, event, connection.id);
            },
            sendEventToOthers: (context, event) => {
                this._sendEventToOthers(context, connection.id, event);
            },
            iterateOtherConnections: () => {
                return filterMapIterable(this._connections.values(), otherConnection =>
                    otherConnection.id !== connection.id && !otherConnection.isSoftClosed()
                        ? otherConnection.connection
                        : undefined,
                );
            },
            closeWithError: (context, error) => {
                connection.closeWithError(context, error);
            },
            resetAuthorizationTimer: context => {
                context.process.waitUntil(
                    connection
                        .authorize()
                        // We throw a close error in the test connection wrapper after a test completes on
                        // our own. The developer can catch a close error with `getCloseError()`.
                        .catch(() => {}),
                );
            },
        });

        // In tests, block establishing the connection on authorization.
        await connectActionContext.tracer.withSpan(
            webSocketConnectionAuthorizationSpanName,
            (context, span) => {
                span.addData({common: {isBlocking: true}});

                return actualConnection.authorize(context as Context<ActionContextModules>);
            },
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
                // Hopefully this is fired synchronously and we get the context object passed into
                // our `close()` call.
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
            peekEvents: () => connection.peekEvents(),
            subscribeToEvents: listener => connection.subscribeToEvents(listener),
            authorize: () => connection.authorize(),
            isClosed: () => connection.isClosed(),
            close: () => connection.close(),
            getCloseError: () => connection.getCloseError(),
        };
    }
}

/**
 * WebSocket server connections are implemented either with a real WebSocket client
 * or a test WebSocket client only available in unit tests.
 */
interface WebSocketServerConnectionWrapperBase<
    ProcessContextModules extends {},
    ActionContextModules extends {actor: ActorContextModule},
    EventStub,
    Connection,
> {
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
    close(context: Context<ProcessContextModules>, code?: number, reason?: string): void;

    /**
     * Sends an error as the last message then closes the connection. Does nothing if
     * the connection is already closed.
     */
    closeWithError(context: Context<ProcessContextModules>, error: unknown): void;

    /**
     * Is the connection soft closed? While soft closed we stop sending the connection
     * new messages but wait to fully close until we've sent acknowledgements for any
     * messages previously sent by the client. The client is responsible for fully
     * closing the connection once it has received all of its acknowledgements.
     */
    isSoftClosed(): boolean;

    /**
     * Soft closes the connection. Does nothing if the connection is already closed.
     */
    softClose(context: Context<ProcessContextModules>): Promise<void>;

    /**
     * Send an event over our WebSocket connection. You provide this function an
     * `EventStub` which the connection will transform with `transformEvent()`.
     */
    sendEvent(
        context: Context<ProcessContextModules> | Context<ActionContextModules>,
        eventStub: EventStub,
    ): SafeFloatingPromise<void>;

    /**
     * The WebSocket server will try to occasionally expire connections that have gone
     * offline. When the WebSocket server's expiration check timer triggers it calls
     * this function. Does nothing if the connection is already closed.
     */
    maybeExpire(context: Context<ProcessContextModules>, currentTimeMs: number): void;
}

const webSocketConnectionAuthorizationSpanName = "Authorizing WebSocket connection";

/**
 * A successful WebSocket connection authorization is invalidated after this time
 * period. At this point, we block all message sending and receiving until
 * authorization is revalidated.
 */
const webSocketConnectionAuthorizationInvalidatedMs = 1000 * 60 * 2;

/**
 * After this time period has elapsed since our last WebSocket connection
 * authorization, we re-run authorization to make sure we're still authorized. This
 * value is less than `webSocketConnectionAuthorizationInvalidatedMs` so that we
 * can run authorization in the background without blocking the sending or
 * receiving of realtime messages.
 *
 * In practice, this is the true interval at which we refresh WebSocket
 * authorization.
 *
 * Authorization is refreshed lazily when the connection has activity. If the
 * connection is sitting idle with only ping/pong then we don't run authorization.
 */
const webSocketConnectionAuthorizationRevalidateMs =
    webSocketConnectionAuthorizationInvalidatedMs - 1000 * 10;

class WebSocketServerConnectionWrapper<
    ProcessContextModules extends {
        process: ProcessContextModule;
        tracer: TracerContextModule;
        fork?: undefined;
    },
    ActionContextModules extends {
        process: ProcessContextModule;
        tracer: TracerContextModule;
        actor: ActorContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        fork: ForkActionContextModule;
        [key: string]: ForkableContextModuleBase;
    },
    Protocol extends WebSocketProtocolBase,
    EventStub,
    Connection extends WebSocketServerConnectionBase<
        ProcessContextModules,
        ActionContextModules,
        Protocol,
        EventStub
    >,
> implements WebSocketServerConnectionWrapperBase<
    ProcessContextModules,
    ActionContextModules,
    EventStub,
    Connection
> {
    public readonly id: WebSocketConnectionId;
    private readonly _accountId: AccountId;
    private readonly _processContext: Context<ProcessContextModules>;
    private readonly _socket: WebSocket;
    private readonly _messageFromClientSchema: Schema<WebSocketMessageFromClient<Protocol>>;
    private readonly _messageFromServerSchema: Schema<WebSocketMessageFromServer<Protocol>>;
    public readonly connection: Connection;
    private readonly _detachedForker: ForkActionContextModuleDetachedForker<
        ActionContextModules & {actor: SessionActorContextModule}
    >;
    private readonly _contextForCloseEventListenerRef: {
        current: Context<ProcessContextModules> | Context<ActionContextModules> | null;
    };
    private _lastMessageTime: number = Date.now();

    /**
     * Is the connection soft closed? While soft closed the connection can not send or
     * receive new messages. It also stops showing up in `iterateOtherConnections()` so
     * it's not observable by other connections. However it still receives ping/pong
     * events and message acknowledgements. Clients will go into this state when the
     * user requested a close but we still are waiting on some message
     * acknowledgements.
     *
     * The client is expected to close the WebSocket when it is done receiving its
     * message acknowledgements. The server does not keep track of the remaining number
     * of unacknowledged messages.
     */
    private _isSoftClosed = false;

    /**
     * A set of promises from `ProcedureRequest` calls. When soft closing our
     * connection we wait for all requests to finish before fully closing the
     * connection.
     */
    private readonly _pendingProcedureRequestPromises = new Set<Promise<void>>();

    private _authorizationState: {
        startTime: number;
        promise: Promise<void> & {
            // Allow us to synchronously check whether the authorization promise has been
            // fulfilled.
            status?: "fulfilled";
        };
        next: {
            startTime: number;
            promise: Promise<void>;
        } | null;
    } | null = null;

    constructor({
        id,
        accountId,
        processContext,
        connectActionContext,
        socket,
        messageFromClientSchema,
        messageFromServerSchema,
        connection,
        contextForCloseEventListenerRef,
    }: {
        id: WebSocketConnectionId;
        accountId: AccountId;
        processContext: Context<ProcessContextModules>;
        connectActionContext: Context<ActionContextModules & {actor: SessionActorContextModule}>;
        socket: WebSocket;
        messageFromClientSchema: Schema<WebSocketMessageFromClient<Protocol>>;
        messageFromServerSchema: Schema<WebSocketMessageFromServer<Protocol>>;
        connection: Connection;
        contextForCloseEventListenerRef: {
            current: Context<ProcessContextModules> | Context<ActionContextModules> | null;
        };
    }) {
        this.id = id;
        this._accountId = accountId;
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
                        .logException("Invalid WebSocket message", error);
                    return;
                }

                const serviceName = this._processContext.tracer.getRoot().serviceName;
                const spanName = `Handle: ${serviceName} message`;
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
                            .logException("Invalid trace propagation context", error);

                        ({span, finishSpan} = this._processContext.tracer
                            .getRoot()
                            .startSpan(spanName));
                    }
                }

                await this._detachedForker.withForkFromCustomSpan(
                    {span, finishSpan},
                    async (context, span) => {
                        try {
                            const handleSpanName =
                                message.type === "ProcedureRequest"
                                    ? `${serviceName} procedure ${message.input.type}`
                                    : `${serviceName} message ${message.type}`;

                            span.recklesslyOverrideName(`Handle: ${handleSpanName}`);

                            span.addData({
                                webSocket: {
                                    connectionId: this.id,
                                    messageType:
                                        message.type === "ProcedureRequest"
                                            ? `ProcedureRequest:${message.input.type}`
                                            : message.type,
                                },
                            });

                            span.addPropagatedDataForChildrenOnly({
                                context: {handler: handleSpanName},
                            });

                            // If the client soft closed our connection we won't accept new procedures. We
                            // still process ping/pong messages since that tells us the connection is still
                            // alive.
                            //
                            // It is important that this comes before any `await`s like our
                            // `await Session.get()` below so we don't have any race conditions between the
                            // `SoftCloseWhileWaitingForProcedureResponses` message and other messages.
                            if (this._isSoftClosed && message.type === "ProcedureRequest")
                                throw new FailedPreconditionError(
                                    "WebSocket connection can not process new procedures when soft closed",
                                );

                            switch (message.type) {
                                // In response to a ping event, we want to send "pong" to the client so it knows we
                                // are alive and didn't silently disconnect.
                                //
                                // We want to skip authorization when sending the `Pong` message. We should only
                                // authorize if the connection is actively being used.
                                case "Ping": {
                                    const messageType = "Pong";

                                    this._dangerouslySendRawMessageEvenWhenSoftClosedWithoutAuthorization(
                                        context,
                                        messageType,
                                        JSON.stringify(
                                            this._messageFromServerSchema.serialize({
                                                type: messageType,
                                                checkpoint:
                                                    generateServerSynchronizationCheckpoint(),
                                            }),
                                        ),
                                    );
                                    break;
                                }
                                case "ProcedureRequest": {
                                    const promise = (async () => {
                                        // Make sure we are authorized before processing a procedure from the client...
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
                                    })();

                                    this._pendingProcedureRequestPromises.add(promise);
                                    void promise.finally(() =>
                                        this._pendingProcedureRequestPromises.delete(promise),
                                    );

                                    await promise;
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

        // If we haven't gotten a message from the client in a while, close it. Maybe the
        // client's power went out and it silently went away without telling us.
        if (currentTimeMs - this._lastMessageTime >= webSocketExpirationTimeoutMs) {
            this.close(context, 1002, "WebSocket connection expired due to inactivity");
            return;
        }
    }

    /**
     * Resets the authorization timer and immediately reauthorizes the WebSocket
     * connection in the background. Useful if you suspect a connection's access
     * changed based on a realtime event and want to immediately reauthorize.
     */
    public resetAuthorizationTimer(
        context: Context<ProcessContextModules> | Context<ActionContextModules>,
    ) {
        void this._authorize(context, {force: true});
    }

    private _authorize(
        context: Context<ProcessContextModules> | Context<ActionContextModules>,
        {force = false}: {force?: boolean} = {},
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

        const actuallyAuthorize = (isBlocking: boolean) => {
            if (
                "actor" in context &&
                // We can only use the current context when the actor of the current context is the
                // same account as the connection we're trying to authorize. Otherwise we'll run
                // the authorization function with the wrong account which is very bad!
                context.actor.type === "Session" &&
                context.actor.getAccountId() === this._accountId
            ) {
                return context.tracer.withSpan(
                    webSocketConnectionAuthorizationSpanName,
                    (context, span) => {
                        span.addPropagatedData({
                            context: {
                                accountId: this._accountId,
                                webSocketConnectionId: this.id,
                            },
                        });

                        // Our authorization promise is blocking if handling procedures or sending the
                        // connection new events is blocked on the authorization promise finishing.
                        span.addData({common: {isBlocking}});

                        return this.connection.authorize(context as Context<ActionContextModules>);
                    },
                );
            } else {
                const parentSpan = context.tracer.getTracer();

                if (parentSpan instanceof TracerSpan) {
                    return this._detachedForker.withForkFromCustomSpan(
                        parentSpan.startSpan(webSocketConnectionAuthorizationSpanName),
                        (context, span) => {
                            span.addPropagatedData({
                                context: {
                                    accountId: this._accountId,
                                    webSocketConnectionId: this.id,
                                },
                            });

                            // Our authorization promise is blocking if handling procedures or sending the
                            // connection new events is blocked on the authorization promise finishing.
                            span.addData({common: {isBlocking}});

                            return this.connection.authorize(context);
                        },
                    );
                } else {
                    return this._detachedForker.withFork(
                        webSocketConnectionAuthorizationSpanName,
                        (context, span) => {
                            span.addPropagatedData({
                                context: {
                                    accountId: this._accountId,
                                    webSocketConnectionId: this.id,
                                },
                            });

                            // Our authorization promise is blocking if handling procedures or sending the
                            // connection new events is blocked on the authorization promise finishing.
                            span.addData({common: {isBlocking}});

                            return this.connection.authorize(context);
                        },
                    );
                }
            }
        };

        // This branch runs if one of the following is true:
        //
        // 1. This connection hasn't authorized yet; OR
        // 2. We have an authorization promise that's invalidated and have not started a
        //    new authorization promise in the background; OR
        // 3. We had started a new authorization promise in the background but enough time
        //    has passed that the background authorization promise has become invalidated;
        //    OR
        // 4. Reauthorization is forced by the `force` flag.
        //
        // We reach case 3 if the branch above sets the new authorization promise but the
        // new authorization promise is also invalidated.
        if (
            force ||
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
            ).then(() => actuallyAuthorize(true));

            this._authorizationState = {
                startTime: currentTime,
                promise: authorizationPromise,
                next: null,
            };
        }

        // If we've passed our revalidation timeout then re-run authorization in the
        // background. Once our current authorization promise expires we can switch to this
        // one.
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
                actuallyAuthorize(false),
            );

            context.process.waitUntil(
                // Ignore errors in the `waitUntil()` call. We'll close the connection with an
                // error so the user will see it.
                authorizationPromise.catch(() => {}),
            );

            this._authorizationState.next = {
                startTime: currentTime,
                promise: authorizationPromise,
            };
        }

        const newAuthorizationPromise = this._authorizationState.promise;

        // If we have a new authorization promise then register callbacks for when it
        // finishes...
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
                        const messageType = "ClosingWithError";

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
     * Send an event over our WebSocket connection. You provide this function an
     * `EventStub` which the connection will transform with `transformEvent()`.
     */
    public sendEvent(
        originalContext: Context<ProcessContextModules> | Context<ActionContextModules>,
        eventStub: EventStub,
    ): SafeFloatingPromise<void> {
        // Do not send events to a soft closed WebSocket. A soft closed WebSocket is in the
        // process of cleaning up and only expects acknowledgements for previously sent
        // procedures and pong messages.
        //
        // Once the client receives all of its procedure responses then it closes for real.
        if (this.isClosed() || this._isSoftClosed) return voidSafeFloatingPromise;

        const run = async (
            context: Context<ActionContextModules & {actor: SessionActorContextModule}>,
            span: TracerSpan,
        ) => {
            span.addPropagatedData({
                context: {
                    accountId: context.actor.getAccountId(),
                    webSocketConnectionId: this.id,
                },
            });

            span.addData({
                webSocket: {
                    connectionId: this.id,
                    messageType: "Event",
                },
            });

            let event: WebSocketProtocolEventType<Protocol>;

            try {
                event = await this.connection.transformEvent(context, eventStub);
            } catch (error) {
                span.addData({common: {didNothing: true}});
                span.addException(error);

                // If `transformEvent()` fails then close the WebSocket connection. We want to
                // close in case `transformEvent()` throws because the actor lost access to the
                // underlying resource we're connected to. The client will decide to reconnect if
                // needed.
                this.closeWithError(context, error);
                return;
            }

            // Once we have the event type, add it to the span.
            span.appendName(` (${event.type})`);
            span.addData({webSocket: {messageType: `Event (${event.type})`}});

            // Check whether we soft closed during the event transform.
            if (this._isSoftClosed) {
                span.addData({common: {didNothing: true}});
                return;
            }

            this._dangerouslySendRawMessageEvenWhenSoftClosed(
                context,
                {type: "Event", event},
                true, // `withoutLogging`
            );
        };

        // If we're calling `sendEvent()` with a session actor matching this connection's
        // `AccountId` then we can use the current context to call `transformEvent()`.
        // Otherwise we need to use our forker to get a context with an actor matching the
        // context's `AccountId`.
        if (
            "actor" in originalContext &&
            originalContext.actor.type === "Session" &&
            originalContext.actor.getAccountId() === this._accountId
        ) {
            return originalContext.process.waitUntil(
                originalContext.tracer.withSpan("Sent WebSocket message Event", (context, span) =>
                    run(
                        context as Context<
                            ActionContextModules & {actor: SessionActorContextModule}
                        >,
                        span,
                    ),
                ),
            );
        } else {
            const {span, finishSpan} = originalContext.tracer
                .getTracer()
                .startSpan(`Sent WebSocket message Event`);

            return originalContext.process.waitUntil(
                this._detachedForker.withForkFromCustomSpan(
                    {span, finishSpan},
                    // If this is an action context, then we want to share the action cache and batches
                    // with the forked context. Importantly, if `sendEvent()` is called multiple times
                    // we want any RPC calls made by `transformEvent()` to be batched together.
                    //
                    // For example, when `MessagingRealtimeConnection` sends `NewMessage` events and we
                    // need to call the `getChatMessageReferences()` RPC. Those
                    // `getChatMessageReferences()` RPC calls should be batched.
                    "batch" in originalContext
                        ? ({
                              cache: originalContext.cache.forkForChangedActor(),
                              batch: originalContext.batch.forkForChangedActor(),
                          } as Partial<ActionContextModules & {actor: SessionActorContextModule}>)
                        : {},
                    context => run(context, span),
                ),
            );
        }
    }

    /**
     * Send a message over our WebSocket connection.
     */
    public sendMessage(
        context: Context<ProcessContextModules> | Context<ActionContextModules>,
        message: Exclude<WebSocketMessageFromServer<Protocol>, {readonly type: "Event"}>,
    ) {
        // This assert is extra protection in addition to the TypeScript
        // `Exclude<Message, {type: "Event"}>` to really make sure the actor isn't calling
        // this function with an event.
        assert(cast<string>(message.type) !== "Event", "Must use `sendEvent()` to send events");

        this._dangerouslySendRawMessageEvenWhenSoftClosed(context, message);
    }

    /**
     * Send a message over our WebSocket connection.
     *
     * Dangerous since you must guarantee the message is well-formed as this only takes
     * a string.
     *
     * Will send a message even when the connection is soft closed! We should only be
     * sending ping/pong and acknowledgement messages when soft closed. If you are
     * calling this function you should check `isSoftClosed()` before calling.
     */
    private _dangerouslySendRawMessageEvenWhenSoftClosed(
        context: Context<ProcessContextModules> | Context<ActionContextModules>,
        message: WebSocketMessageFromServer<Protocol>,
        withoutLogging: boolean = false,
    ) {
        const messageType = withoutLogging
            ? null
            : message.type === "ProcedureResponse"
              ? `ProcedureResponse (${
                    message.result.ok ? message.result.output.type : message.result.outputType
                })`
              : message.type === "Event"
                ? `Event (${message.event.type})`
                : message.type;

        const serializedMessage = this._messageFromServerSchema.serialize(message);
        const serializedMessageString = JSON.stringify(serializedMessage);

        const authorizationPromise = this._authorize(context);

        if (authorizationPromise.status === "fulfilled") {
            this._dangerouslySendRawMessageEvenWhenSoftClosedWithoutAuthorization(
                context,
                messageType,
                serializedMessageString,
            );
        } else {
            context.process.waitUntil(
                authorizationPromise.then(
                    () => {
                        this._dangerouslySendRawMessageEvenWhenSoftClosedWithoutAuthorization(
                            context,
                            messageType,
                            serializedMessageString,
                        );
                    },
                    () => {
                        // Ignore authorization error. We send a `ClosingWithError` message when
                        // authorization fails so rejecting our `waitUntil()` is redundant.
                    },
                ),
            );
        }
    }

    private _dangerouslySendRawMessageEvenWhenSoftClosedWithoutAuthorization(
        context: Context<{tracer: TracerContextModule}>,
        messageType: string | null,
        message: string,
    ) {
        // Don't send messages to a closed WebSocket. The WebSocket may not have been
        // cleaned up yet because it is closing. We will definitely cleanup the WebSocket
        // on our expiration pass if missed the close event.
        if (this.isClosed()) {
            return;
        }

        this._socket.send(message);

        // If `messageType` is null then the caller has disabled logging. Hopefully because
        // they've logged an event of their own.
        if (messageType !== null) {
            context.tracer.log(`Sent WebSocket message ${messageType}`, {
                webSocket: {
                    connectionId: this.id,
                    messageType,
                },
            });
        }
    }

    /**
     * Close the underlying WebSocket with the provided code and reason.
     *
     * The close codes can be found [here][1]. The reason string can be an arbitrary
     * string explaining why we are closing.
     *
     * [1]: https://www.rfc-editor.org/rfc/rfc6455.html#section-7.4.1
     */
    public close(
        context: Context<ProcessContextModules> | Context<ActionContextModules>,
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

    /**
     * Sends an error message then closes the underlying WebSocket. Useful for
     * communicating to the client why we're closing so the client can show an error
     * message to the user (if it was a user error not a system error).
     *
     * If the WebSocket is already closed this does nothing.
     */
    public closeWithError(
        context: Context<ProcessContextModules> | Context<ActionContextModules>,
        error: unknown,
    ) {
        this._dangerouslySendRawMessageEvenWhenSoftClosedWithoutAuthorization(
            context,
            "ClosingWithError",
            JSON.stringify(
                this._messageFromServerSchema.serialize({
                    type: "ClosingWithError",
                    error,
                }),
            ),
        );

        this.close(context, isSystemError(error) ? 1011 : 1008);
    }

    /**
     * Wait for any pending procedure requests to finish then close the underlying
     * WebSocket. This is a peaceful way to close a WebSocket connection since any work
     * started by the client is completed. (e.g. Database writes.)
     *
     * This is typically used during a graceful server shutdown to make sure work is
     * completed before we kill the server.
     *
     * We tell the client we're soft closing so they're expected to immediately start a
     * new connection. In the graceful server shutdown case the client will be
     * redirected to a live server.
     */
    public async softClose(
        context: Context<ProcessContextModules> | Context<ActionContextModules>,
    ) {
        // WebSocket is already closed.
        if (this.isClosed()) return;

        // If there are no pending procedure requests then immediately close.
        if (this._pendingProcedureRequestPromises.size === 0) {
            this.close(context);
            return;
        }

        // Let the client know we're soft closing if they don't know already...
        if (!this._isSoftClosed) {
            const messageType = "SoftCloseWhileWaitingForProcedureResponses";

            this._dangerouslySendRawMessageEvenWhenSoftClosedWithoutAuthorization(
                context,
                messageType,
                JSON.stringify(
                    this._messageFromServerSchema.serialize({
                        type: messageType,
                    }),
                ),
            );
        }

        this._isSoftClosed = true;

        while (this._pendingProcedureRequestPromises.size > 0) {
            await runAllPromises(this._pendingProcedureRequestPromises);
        }

        // Close after all our procedure requests have finished.
        this.close(context);
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
    ActionContextModules extends {},
    Protocol extends WebSocketProtocolBase,
    EventStub,
    Connection extends WebSocketServerConnectionBase<
        ProcessContextModules,
        ActionContextModules,
        Protocol,
        EventStub
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
     * `takeEvents()` call. Calling this function will clear the array so if you call
     * it immediately it will be empty.
     *
     * If you have a subscriber with `subscribeToEvents()` then messages observed by
     * that function will still show up in `takeEvents()`.
     *
     * This function allows you to pull new messages, `subscribeToEvents()` lets the
     * server push new messages to you.
     */
    takeEvents(): Array<WebSocketProtocolEventType<Protocol>>;

    /**
     * Get all events sent by the WebSocket server to the client since the last
     * `takeEvents()` call.
     *
     * Unlike `takeEvents()`, calling this function won't clear the buffered event
     * array. You can keep calling `peekEvents()` repeatedly and get the same result.
     */
    peekEvents(): Array<WebSocketProtocolEventType<Protocol>>;

    /**
     * Subscribe to events from the server as they are published. Returns a function
     * that lets you unsubscribe.
     */
    subscribeToEvents(
        listener: (message: WebSocketProtocolEventType<Protocol>) => void,
    ): () => void;

    /**
     * Run the connection's authorization procedure to reauthorize. If authorization
     * fails then the connection will be closed.
     */
    authorize(): Promise<void>;

    /**
     * Is the connection closed?
     */
    isClosed(): boolean;

    /**
     * Close the connection. Does nothing if the connection is already closed.
     */
    close(): void;

    /**
     * If the connection was closed with an error this will be the error provided when
     * closed.
     */
    getCloseError(): unknown;
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
    ProcessContextModules extends {
        process: ProcessContextModule;
        tracer: TracerContextModule;
    },
    ActionContextModules extends {
        process: ProcessContextModule;
        tracer: TracerContextModule;
        fork: ForkActionContextModule;
        actor: ActorContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
    },
    Protocol extends WebSocketProtocolBase,
    EventStub,
    Connection extends WebSocketServerConnectionBase<
        ProcessContextModules,
        ActionContextModules,
        Protocol,
        EventStub
    >,
> implements WebSocketServerConnectionWrapperBase<
    ProcessContextModules,
    ActionContextModules,
    EventStub,
    Connection
> {
    public readonly id: WebSocketConnectionId;
    public readonly _accountId: AccountId;
    public readonly connection: Connection;
    private readonly _detachedForker: ForkActionContextModuleDetachedForker<
        ActionContextModules & {actor: SessionActorContextModule}
    >;
    private readonly _messageFromClientSchema: Schema<WebSocketMessageFromClient<Protocol>>;
    private readonly _messageFromServerSchema: Schema<WebSocketMessageFromServer<Protocol>>;
    private _isClosed = false;
    private readonly _closeEvent = new EventEmitter();
    private _closeError: {hasError: false} | {hasError: true; error: unknown; wasCaught: boolean} =
        {hasError: false};
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
        actionContext: Context<ActionContextModules & {actor: SessionActorContextModule}>;
        messageFromClientSchema: Schema<WebSocketMessageFromClient<Protocol>>;
        messageFromServerSchema: Schema<WebSocketMessageFromServer<Protocol>>;
        connection: Connection;
    }) {
        // Can only use test connections in Jest.
        assert(import.meta.jest);

        this.id = id;
        this._accountId = actionContext.actor.getAccountId();
        this.connection = connection;
        this._detachedForker = actionContext.fork.getDetachedForker();
        this._messageFromClientSchema = messageFromClientSchema;
        this._messageFromServerSchema = messageFromServerSchema;

        assertExists(afterNextCallbacksForTest).push(async () => {
            await ProcessContextModule.waitForTestTasks();

            // In tests, authorize every connection after the current test completes to make
            // sure we didn't lose access while the test was executing.
            if (!this._isClosed) {
                await this._detachedForker.withFork(
                    webSocketConnectionAuthorizationSpanName,
                    (context, span) => {
                        span.addData({common: {isBlocking: false}});

                        return this.connection.authorize(context);
                    },
                );
            }

            if (this._closeError.hasError && !this._closeError.wasCaught) {
                throw new InternalError(
                    "WebSocket connection closed with error (catch error by calling `getCloseError()`)",
                    {cause: this._closeError.error},
                );
            }
        });
    }

    public async executeProcedure<
        Name extends keyof WebSocketProtocolProceduresType<Protocol> & string,
    >(
        name: Name,
        input: WebSocketProtocolProceduresType<Protocol>[Name]["input"],
    ): Promise<WebSocketProtocolProceduresType<Protocol>[Name]["output"]> {
        if (this._isClosed) throw new CancelledError("WebSocket connection closed");

        const output = await this._detachedForker.withFork(
            "Handle: Test WebSocket message",
            async (context, span) => {
                // Thrown errors should be handled by the test. We do not send acknowledgement
                // messages in test connections.
                return await this.connection.procedures[name](context, input, span);
            },
        );

        return output as any;
    }

    public takeEvents(): Array<WebSocketProtocolEventType<Protocol>> {
        const messages = this._bufferedEvents;
        this._bufferedEvents = [];
        return messages;
    }

    public peekEvents(): Array<WebSocketProtocolEventType<Protocol>> {
        return this._bufferedEvents.slice();
    }

    public subscribeToEvents(listener: (event: WebSocketProtocolEventType<Protocol>) => void) {
        return this._events.subscribe(listener);
    }

    public authorize() {
        return this._detachedForker.withFork(
            webSocketConnectionAuthorizationSpanName,
            (context, span) => {
                // Considered non-blocking since we aren't blocking any WebSocket operations like
                // sending or receiving events.
                span.addData({common: {isBlocking: false}});

                return this.connection.authorize(context).catch(error => {
                    this.closeWithError(context, error);
                    throw error;
                });
            },
        );
    }

    public isClosed() {
        return this._isClosed;
    }

    public close() {
        if (this._isClosed) return;
        this._isClosed = true;
        this._closeEvent.emit();
    }

    public closeWithError(context: Context<{}>, error: unknown) {
        this._closeError = {hasError: true, error, wasCaught: false};

        // Don't send `ClosingWithError` message. Test connections only record events not
        // arbitrary messages.

        this.close();
    }

    public getCloseError() {
        if (!this._closeError.hasError) return null;
        this._closeError.wasCaught = true;
        return this._closeError.error;
    }

    public subscribeToClose(listener: () => void) {
        return this._closeEvent.subscribe(listener);
    }

    public isSoftClosed() {
        return this.isClosed();
    }

    public async softClose() {
        throw new UnimplementedError(
            "Soft closing is not implemented for test WebSocket connections",
        );
    }

    // Public so it can be called from `connectForTest()` but should not be called
    // outside of this file.
    public sendEvent(
        originalContext: Context<ProcessContextModules> | Context<ActionContextModules>,
        eventStub: EventStub,
    ): SafeFloatingPromise<void> {
        if (this._isClosed) return voidSafeFloatingPromise;

        const run = async (
            context: Context<ActionContextModules & {actor: SessionActorContextModule}>,
            span: TracerSpan,
        ) => {
            span.addPropagatedData({
                context: {
                    accountId: context.actor.getAccountId(),
                    webSocketConnectionId: this.id,
                },
            });

            span.addData({
                webSocket: {
                    connectionId: this.id,
                    messageType: "Event",
                },
            });

            let event: WebSocketProtocolEventType<Protocol>;

            try {
                event = await this.connection.transformEvent(context, eventStub);
            } catch (error) {
                span.addData({common: {didNothing: true}});
                span.addException(error);

                // If `transformEvent()` fails then close the WebSocket connection. We want to
                // close in case `transformEvent()` throws because the actor lost access to the
                // underlying resource we're connected to. The client will decide to reconnect if
                // needed.
                this.closeWithError(context, error);
                return;
            }

            // Once we have the event type, add it to the span.
            span.appendName(` (${event.type})`);
            span.addData({webSocket: {messageType: `Event (${event.type})`}});

            this._bufferedEvents.push(event);
            this._events.emit(event);
        };

        // If we're calling `sendEvent()` with a session actor matching this connection's
        // `AccountId` then we can use the current context to call `transformEvent()`.
        // Otherwise we need to use our forker to get a context with an actor matching the
        // context's `AccountId`.
        if (
            "actor" in originalContext &&
            originalContext.actor.type === "Session" &&
            originalContext.actor.getAccountId() === this._accountId
        ) {
            return originalContext.process.waitUntil(
                originalContext.tracer.withSpan("Sent WebSocket message Event", (context, span) =>
                    run(
                        context as Context<
                            ActionContextModules & {actor: SessionActorContextModule}
                        >,
                        span,
                    ),
                ),
            );
        } else {
            const {span, finishSpan} = originalContext.tracer
                .getTracer()
                .startSpan(`Sent WebSocket message Event`);

            return originalContext.process.waitUntil(
                this._detachedForker.withForkFromCustomSpan(
                    {span, finishSpan},
                    // If this is an action context, then we want to share the action cache and batches
                    // with the forked context. Importantly, if `sendEvent()` is called multiple times
                    // we want any RPC calls made by `transformEvent()` to be batched together.
                    //
                    // For example, when `MessagingRealtimeConnection` sends `NewMessage` events and we
                    // need to call the `getChatMessageReferences()` RPC. Those
                    // `getChatMessageReferences()` RPC calls should be batched.
                    "batch" in originalContext
                        ? ({
                              cache: originalContext.cache.forkForChangedActor(),
                              batch: originalContext.batch.forkForChangedActor(),
                          } as Partial<ActionContextModules & {actor: SessionActorContextModule}>)
                        : {},
                    context => run(context, span),
                ),
            );
        }
    }

    public maybeExpire() {
        // Test connections never expire...
        return {wasClosed: false};
    }
}
