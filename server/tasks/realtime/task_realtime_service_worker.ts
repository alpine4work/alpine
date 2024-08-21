import {WebSocketPair} from "#server/web_socket/internal/web_socket_pair.js";
import {Session} from "~/server/accounts/accounts_table.js";
import {
    DynamoActorContextModule,
    DynamoSessionActorContextModule,
    DynamoSystemActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerSessionActionContext,
    ServerSessionActionContextModules,
    ServerSystemActionContext,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoBatchContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {
    createServerProcessContext,
    serverProcessContextParseOptions,
} from "~/server/node/create_server_process_context.js";
import {
    createServiceTokenAgent,
    serviceTokenAgentParseOptions,
} from "~/server/node/create_service_token_agent.js";
import {createStandardizedServerWithWebSockets} from "~/server/node/create_standardized_server.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {
    authorizeSpaceAccess,
    isAccountMemberOfSpaceWithoutAuthorization,
} from "~/server/spaces/spaces_table.js";
import {prepareTaskForClient} from "~/server/tasks/data/prepare_task_for_client.js";
import {loadTaskRealtimeQueries} from "~/server/tasks/realtime/load_task_realtime_queries.js";
import {TaskRealtimeConnection} from "~/server/tasks/realtime/task_realtime_connection.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {TaskRealtimeSystemActionContext} from "~/server/tasks/realtime/task_realtime_system_action_context.js";
import {
    TaskRealtimeApplyActionTransactionInputSchema,
    TaskRealtimeGetTaskWithoutDependenciesOutputSchema,
    TaskRealtimeLoadQueriesInputSchema,
    TaskRealtimeLoadQueriesOutputSchema,
} from "~/server/tasks/router/task_realtime_service_procedure_schemas.js";
import {taskRealtimeServiceDiscoveryWaitMs} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
    UnauthenticatedError,
} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {isId} from "~/shared/id/id.js";
import {SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskRealtimeProtocol} from "~/shared/tasks/task_realtime_protocol.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";
import {WebSocketClosingWithErrorMessageSchema} from "~/shared/web_socket/web_socket_schema.js";

type TaskRealtimeSessionActionContextModules = ServerSessionActionContextModules & {
    fork: ForkActionContextModule;
};

type TaskRealtimeServiceRoute =
    | {readonly type: "HealthCheck"}
    | {readonly type: "NotFound"}
    | {readonly type: "Main"; readonly spaceId: SpaceId}
    | {readonly type: "ApplyActionTransaction"; readonly spaceId: SpaceId}
    | {readonly type: "LoadQueries"; readonly spaceId: SpaceId}
    | {
          readonly type: "GetTaskWithoutDependencies";
          readonly spaceId: SpaceId;
          readonly taskId: TaskId;
      };

type Options = ServiceOptions<typeof options>;

export const options = {
    portBase: {type: "string"},
    ...serviceTokenAgentParseOptions,
    ...serverProcessContextParseOptions,
} as const;

export async function run({
    options,
    tracer,
    shutdownManager,
    workerIndex,
}: {
    options: Options;
    tracer: TracerRoot;
    shutdownManager: ShutdownManager;
    workerIndex: number;
}) {
    const portBase = options.portBase ? parseInt(options.portBase, 10) : null;
    if (!portBase || !Number.isInteger(portBase))
        throw new InternalError("Missing integer `portBase` arg");

    // In `development` environments our service only has one worker. Listen on
    // `portBase` instead of `portBase + 1`.
    const port = process.env.NODE_ENV !== "production" ? portBase : portBase + workerIndex + 1;

    const tokenAgent = await createServiceTokenAgent({
        serviceName: "TaskRealtimeService",
        options,
    });

    const awsSigner = new AwsRequestSigner();

    const processContext = createServerProcessContext({
        tracer,
        tokenAgent,
        awsSigner,
        options,
    });

    const [server, {start}] = TaskRealtimeServer.new(processContext);

    const startTime = Date.now();

    start(
        process.env.NODE_ENV === "production"
            ? wait(taskRealtimeServiceDiscoveryWaitMs)
            : // In development we only have one `TaskRealtimeService` instance and it's
              // always at the same port. It's always "discovered".
              Promise.resolve(),
    );

    // Sometimes we want to upgrade a session actor to a system actor. This gives
    // the action escalated the system permission level which is dangerous! The
    // system permission level has broad access to a space. We should tightly
    // control what code is allowed to call this function, only allowed context
    // modules get access and those context modules are expected to treat this as a
    // private variable.
    //
    // It's important we use new caches + batchers here. We don't want to load some
    // data at a higher permission level then let the session context see it. So we
    // derive our new context from the process context to help avoid reusing any
    // request-level caches.
    //
    // NOTE(calebmer, 2023-08-07): May be worthwhile turning uses of this function
    // into RPC calls on another machine someday for security? Not sure if that
    // helps.
    const dangerouslyEscalateToSystemContext = <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor: DynamoActorContextModule;
            cache: CacheContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: ServerSystemActionContext) => Promise<Value>,
    ): Promise<Value> => {
        return processContext.with<
            Omit<
                ServerSystemActionContextModules,
                Exclude<keyof ServerProcessContextModules, "tracer">
            >,
            Value
        >(
            {
                tracer: new TracerContextModule(context.tracer.getTracer()),
                // Optimization: Share some caches that opt-in to sharing with the session
                // context. This is dangerous since we don't want to let system data leak into
                // session actions and vice-versa. We trust the cache author to make the right
                // determination about their cache.
                cache: context.cache.dangerouslyForkWithSharedCaches(),
                dynamoBatchContext: new DynamoBatchContextModule(),
                actor: DynamoSystemActorContextModule.dangerouslyNew(
                    context.actor.serviceName,
                    spaceId,
                ),
            },
            action,
        );
    };

    const webSocketServerBySpaceId = new DefaultMap(
        (spaceId: SpaceId) =>
            new WebSocketServer<
                ServerProcessContextModules,
                TaskRealtimeSessionActionContextModules,
                typeof TaskRealtimeProtocol,
                TaskRealtimeConnection
            >(
                processContext,
                TaskRealtimeProtocol,
                ({accountId, sendEvent, closeWithError, resetAuthorizationTimer}) => {
                    return new TaskRealtimeConnection({
                        server,
                        spaceId,
                        accountId,
                        dangerouslyEscalateToSystemContext,
                        sendEvent,
                        closeWithError,
                        resetAuthorizationTimer,
                    });
                },
            ),
    );

    // Gracefully shutdown WebSocket servers when the process is instructed to
    // shutdown. We'll wait for any pending requests before fully shutting down.
    shutdownManager.registerListenerForIngressTraffic(
        "Closing all WebSocket connections",
        async (signal, span) => {
            await runAllPromises(
                mapIterable(webSocketServerBySpaceId.values(), webSocketServer =>
                    webSocketServer.softCloseAll(
                        processContext.clone({tracer: new TracerContextModule(span)}),
                    ),
                ),
            );
        },
    );

    const handleRequest = async (
        request: Request,
        route: Exclude<TaskRealtimeServiceRoute, {type: "HealthCheck"} | {type: "NotFound"}>,
        span: TracerSpan,
    ): Promise<Response | void> => {
        const {spaceId} = route;

        const baseContext = processContext.clone({
            tracer: new TracerContextModule(span),
            cache: new CacheContextModule(),
            dynamoBatchContext: new DynamoBatchContextModule(),
        });

        const actorContextModule = await createActorContextModule(
            baseContext,
            request,
            tokenAgent,
            spaceId,
        );

        switch (route.type) {
            case "Main": {
                // NOTE(calebmer): This condition is important for security!
                // `TaskRealtimeService` has routes to the public internet so our Cloudflare
                // Worker `EdgeService` can make a connection. However, ONLY `EdgeService`
                // should be allowed to make WebSocket connections. This check makes sure of
                // that. Session cookies would use an `AppClient` service name, you need access
                // to `EdgeService`'s private key to get past this check.
                if (actorContextModule.serviceName !== "EdgeService") {
                    throw new PermissionDeniedError("Only `EdgeService` can connect via WebSocket");
                }

                if (!(actorContextModule instanceof DynamoSessionActorContextModule)) {
                    throw new PermissionDeniedError(
                        "Only session actors can connect via WebSocket",
                    );
                }

                return baseContext.with(
                    {
                        actor: actorContextModule,
                        fork: new ForkActionContextModule(),
                    },
                    async context => {
                        const authorizedContext = context.actor.authorizeSession();

                        // Authorize session access before initializing a `WebSocketServer` for a space
                        // that doesn't exist. That way attackers can't exploit a memory leak to create
                        // infinite `WebSocketServer`s.
                        await authorizeSpaceAccess(authorizedContext, spaceId);

                        const webSocketServer = webSocketServerBySpaceId.getOrSetDefault(spaceId);

                        return webSocketServer.upgrade(context, request);
                    },
                );
            }
            // This endpoint should be called every time an action transaction is commit in
            // a space that's part of this server's space partition. We add the actions to
            // our action history and broadcast realtime events to all connected clients.
            case "ApplyActionTransaction": {
                if (request.method !== "POST") {
                    throw new InvalidArgumentError(quote`Invalid request method ${request.method}`);
                }

                if (
                    actorContextModule.serviceName !== "AppService" &&
                    // `JobQueueService` can apply transactions by processing the
                    // `RetryUnprocessedTaskActionTransactions` maintenance job.
                    actorContextModule.serviceName !== "JobQueueService"
                ) {
                    throw new PermissionDeniedError(
                        "Only `AppService` or `JobQueueService` can apply transactions",
                    );
                }

                if (!(actorContextModule instanceof DynamoSystemActorContextModule)) {
                    throw new PermissionDeniedError("Only system actors can apply transactions");
                }

                return baseContext.with(
                    {actor: actorContextModule},
                    async (context: TaskRealtimeSystemActionContext) => {
                        const actionTransaction =
                            TaskRealtimeApplyActionTransactionInputSchema.deserialize(
                                await request.json(),
                            );

                        await server.applyActionTransaction(context, {
                            spaceId,
                            committedTime: actionTransaction.committedTime,
                            actions: actionTransaction.actions,
                            clientId: actionTransaction.clientId,
                        });
                    },
                );
            }
            case "LoadQueries": {
                if (request.method !== "POST") {
                    throw new InvalidArgumentError(quote`Invalid request method ${request.method}`);
                }

                if (actorContextModule.serviceName !== "AppService") {
                    throw new PermissionDeniedError("Only `AppService` can load queries");
                }

                if (!(actorContextModule instanceof DynamoSessionActorContextModule)) {
                    throw new PermissionDeniedError("Only session actors can load queries");
                }

                return baseContext.with(
                    {actor: actorContextModule},
                    async (context: ServerSessionActionContext) => {
                        const input = TaskRealtimeLoadQueriesInputSchema.deserialize(
                            await request.json(),
                        );

                        const {queries, extraQueries, updateEvent} = await loadTaskRealtimeQueries(
                            context,
                            {
                                server,
                                dangerouslyEscalateToSystemContext,
                                spaceId,
                                queries: input.queries,
                                taskIds: input.taskIds,
                                collectionIds: input.collectionIds,
                            },
                        );

                        return new Response(
                            JSON.stringify(
                                TaskRealtimeLoadQueriesOutputSchema.serialize({
                                    ok: true,
                                    queries,
                                    extraQueries,
                                    updateEvent,
                                }),
                            ),
                            {
                                status: 200,
                                headers: {"content-type": "application/json"},
                            },
                        );
                    },
                );
            }
            case "GetTaskWithoutDependencies": {
                if (request.method !== "GET") {
                    throw new InvalidArgumentError(quote`Invalid request method ${request.method}`);
                }

                if (actorContextModule.serviceName !== "AppService") {
                    throw new PermissionDeniedError("Only `AppService` can load queries");
                }

                if (!(actorContextModule instanceof DynamoSessionActorContextModule)) {
                    throw new PermissionDeniedError("Only session actors can load queries");
                }

                return baseContext.with({actor: actorContextModule}, async context => {
                    await server.authorizeTaskAccess(context, spaceId, route.taskId, "View");

                    return dangerouslyEscalateToSystemContext(context, spaceId, async context => {
                        const task = await server.getTask(context, spaceId, route.taskId);

                        const taskModel = prepareTaskForClient(
                            actorContextModule.getAccountId(),
                            task,
                        );

                        return new Response(
                            JSON.stringify(
                                TaskRealtimeGetTaskWithoutDependenciesOutputSchema.serialize({
                                    ok: true,
                                    task: taskModel,
                                }),
                            ),
                            {
                                status: 200,
                                headers: {"content-type": "application/json"},
                            },
                        );
                    });
                });
            }
            default:
                throw exhaustive(route);
        }
    };

    const httpServer = createStandardizedServerWithWebSockets<TaskRealtimeServiceRoute>(
        tracer,
        shutdownManager,
        url => {
            if (url.pathname === "/healthcheck") {
                return ["/healthcheck", {type: "HealthCheck"}];
            }

            const pathnameSegments = url.pathname.slice(1).split("/");

            if (!pathnameSegments[0] || !isId<SpaceId>(pathnameSegments[0])) {
                return ["/*", {type: "NotFound"}];
            }

            const spaceId = pathnameSegments[0];

            switch (pathnameSegments[1]) {
                case undefined: {
                    return ["/:spaceId", {type: "Main", spaceId}];
                }
                case "applyActionTransaction": {
                    if (pathnameSegments.length !== 2) return ["/*", {type: "NotFound"}];

                    return [
                        "/:spaceId/applyActionTransaction",
                        {type: "ApplyActionTransaction", spaceId},
                    ];
                }
                case "loadQueries": {
                    if (pathnameSegments.length !== 2) return ["/*", {type: "NotFound"}];

                    return ["/:spaceId/loadQueries", {type: "LoadQueries", spaceId}];
                }
                case "getTaskWithoutDependencies": {
                    if (pathnameSegments.length !== 3) return ["/*", {type: "NotFound"}];

                    if (!pathnameSegments[2] || !isId<TaskId>(pathnameSegments[2])) {
                        return ["/*", {type: "NotFound"}];
                    }

                    return [
                        "/:spaceId/getTaskWithoutDependencies/:taskId",
                        {
                            type: "GetTaskWithoutDependencies",
                            spaceId,
                            taskId: pathnameSegments[2],
                        },
                    ];
                }
                default:
                    return ["/*", {type: "NotFound"}];
            }
        },
        async (request, url, route, span) => {
            if (route.type === "HealthCheck") {
                if (Date.now() - startTime < taskRealtimeServiceDiscoveryWaitMs) {
                    return Promise.resolve(
                        new Response(
                            "503 Service Unavailable: Waiting to be discovered by other services",
                            {status: 503, headers: {"content-type": "text/plain"}},
                        ),
                    );
                }

                return Promise.resolve(
                    new Response("200 OK", {
                        status: 200,
                        headers: {"content-type": "text/plain"},
                    }),
                );
            }

            if (route.type === "NotFound") {
                throw new NotFoundError("Route not found");
            }

            const result = await captureResultPromise(() => handleRequest(request, route, span));

            if (result.ok) {
                return (
                    result.value ??
                    new Response(JSON.stringify({ok: true}), {
                        status: 200,
                        headers: {"content-type": "application/json"},
                    })
                );
            } else {
                span.addException(result.error);

                // If there was an error and the client was trying to connect to a WebSocket
                // then temporarily connect so we can send an error message over the WebSocket
                // protocol then immediately close.
                //
                // e.g. If there was an authorization error during durable object
                // initialization.
                if (request.headers.get("upgrade") !== "websocket") {
                    return new Response(
                        JSON.stringify({ok: false, error: ErrorSchema.serialize(result.error)}),
                        {
                            status: isSystemError(result.error) ? 500 : 400,
                            headers: {"content-type": "application/json"},
                        },
                    );
                } else {
                    const socketPair = new WebSocketPair();
                    const clientSocket = socketPair[0];
                    const serverSocket = socketPair[1];

                    const response = new Response(null, {
                        status: 101,
                        // Cloudflare's WebSocket implementation doesn't fully comply with the
                        // TypeScript DOM WebSocket type (e.g. there is no `bufferedAmount` or
                        // `binaryType` property) but everything seems to be fine regardless.
                        webSocket: clientSocket as any as globalThis.WebSocket,
                    });

                    (serverSocket as any).accept();

                    serverSocket.send(
                        JSON.stringify(
                            WebSocketClosingWithErrorMessageSchema.serialize({
                                type: "ClosingWithError",
                                error: result.error,
                            }),
                        ),
                    );

                    serverSocket.close();

                    return response;
                }
            }
        },
    );

    httpServer.listen(port, () => {
        // Log when ready in production to help when debugging container startup.
        if (process.env.NODE_ENV === "production") {
            // eslint-disable-next-line no-console
            console.log(`Listening on port ${port} (pid: ${process.pid})`);
        }
    });
}

async function createActorContextModule(
    context: Context<
        DynamoContextModules & {
            process: ProcessContextModule;
            cache: CacheContextModule;
        }
    >,
    request: Request,
    tokenAgent: TokenAgent,
    spaceId: SpaceId,
) {
    const authorizationHeader = request.headers.get("authorization");
    if (!authorizationHeader) throw new UnauthenticatedError('Expected an "Authorization" header');

    const authorizationHeaderMatch = authorizationHeader.match(/^bearer (.+)$/i);

    if (!authorizationHeaderMatch) {
        throw new InvalidArgumentError(
            'Expected "Authorization" header to have "Bearer" authentication scheme',
        );
    }

    const authorizationHeaderToken = authorizationHeaderMatch[1] ?? "";
    const {serviceName, payload: authorizationHeaderPayload} =
        await tokenAgent.publicSide.verifyToken(authorizationHeaderToken);

    switch (authorizationHeaderPayload.type) {
        case "Session": {
            const [session] = await runAllPromises([
                Session.getIfExists(
                    context,
                    authorizationHeaderPayload.sessionId,
                    authorizationHeaderPayload.accountId,
                ),
                // Optimization: When loading our session from the database, also attempt to
                // load whether the account associated with the session is a member of the
                // space we're in.
                isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    spaceId,
                    authorizationHeaderPayload.accountId,
                ),
            ]);

            if (!session) {
                throw new PermissionDeniedError("Session not found");
            }
            return DynamoSessionActorContextModule.dangerouslyNew(serviceName, session);
        }
        case "System": {
            if (spaceId !== authorizationHeaderPayload.spaceId) {
                throw new PermissionDeniedError("System actor doesn't have access to space");
            }
            return DynamoSystemActorContextModule.dangerouslyNew(
                serviceName,
                authorizationHeaderPayload.spaceId,
            );
        }
        default:
            throw exhaustive(authorizationHeaderPayload);
    }
}
