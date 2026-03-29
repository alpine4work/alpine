import {WebSocketPair} from "#server/web_socket/internal/web_socket_pair.js";
import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {
    ChatInjectionContextModule,
    DocumentsInjectionContextModule,
    ForumInjectionContextModule,
    SitesInjectionContextModule,
    TasksInjectionContextModule,
} from "~/server/context/injection_context_module.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {
    ActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {
    createServerBasicProcessContextModules,
    serverBasicProcessContextOptions,
} from "~/server/node/create_server_basic_process_context_modules.js";
import {
    createServiceTokenAgent,
    serviceTokenAgentOptions,
} from "~/server/node/create_service_token_agent.js";
import {createStandardizedServerWithWebSockets} from "~/server/node/create_standardized_server.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {
    createServiceOpensearchContextModule,
    serviceOpensearchOptions,
} from "~/server/opensearch/create_service_opensearch_context_module.js";
import {sitesInjection} from "~/server/sites/data/sites_injection.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {createActorContextModuleFromAuthorizationHeader} from "~/server/spaces/create_actor_context_module_from_authorization_header.js";
import {
    TaskRealtimeActionContext,
    TaskRealtimeProcessContextModules,
    TaskRealtimeSessionActionContextModules,
    TaskRealtimeSystemActionContext,
    TaskRealtimeSystemActionContextModules,
} from "~/server/tasks/data/task_realtime_context.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {getTaskCollectionForRealtime} from "~/server/tasks/realtime/get_task_collection_for_realtime.js";
import {getTaskWithoutDependenciesForRealtime} from "~/server/tasks/realtime/get_task_without_dependencies_for_realtime.js";
import {loadTaskRealtimeQueries} from "~/server/tasks/realtime/load_task_realtime_queries.js";
import {TaskRealtimeConnection} from "~/server/tasks/realtime/task_realtime_connection.js";
import {TaskRealtimeServer} from "~/server/tasks/realtime/task_realtime_server.js";
import {taskRealtimeServiceDiscoveryWaitMs} from "~/server/tasks/router/task_realtime_service_router_base.js";
import {WebSocketServer} from "~/server/web_socket/web_socket_server.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
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
import {SpaceId, TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";
import {TaskRealtimeEvent, TaskRealtimeProtocol} from "~/shared/tasks/task_realtime_protocol.js";
import {
    TaskRealtimeApplyActionTransactionInputSchema,
    TaskRealtimeGetCollectionOutput,
    TaskRealtimeGetCollectionOutputSchema,
    TaskRealtimeGetTaskWithoutDependenciesOutput,
    TaskRealtimeGetTaskWithoutDependenciesOutputSchema,
    TaskRealtimeLoadQueriesInputSchema,
    TaskRealtimeLoadQueriesOutputSchema,
} from "~/shared/tasks/task_realtime_service_procedure_schemas.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";
import {WebSocketClosingWithErrorMessageSchema} from "~/shared/web_socket/web_socket_schema.js";

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
      }
    | {
          readonly type: "GetCollection";
          readonly spaceId: SpaceId;
          readonly collectionId: TaskCollectionId;
      };

type Options = ServiceOptions<typeof options>;

export const options = {
    portBase: {type: "string"},
    ...serviceTokenAgentOptions,
    ...serverBasicProcessContextOptions,
    ...serviceOpensearchOptions,
} as const;

export async function run({
    options,
    tracer,
    startupSpan,
    shutdownManager,
    workerIndex,
}: {
    options: Options;
    tracer: TracerRoot;
    startupSpan: TracerSpan;
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

    const awsSigner = new AwsRequestSigner(defaultProvider());
    void awsSigner.prefetchState(startupSpan);

    const processContext = Context.new({
        ...createServerBasicProcessContextModules({
            tracer,
            shutdownManager,
            awsSigner,
            options,
        }),
        opensearch: createServiceOpensearchContextModule(awsSigner, options),
        chatInjection: new ChatInjectionContextModule(chatInjection),
        documentsInjection: new DocumentsInjectionContextModule(documentsInjection),
        forumInjection: new ForumInjectionContextModule(forumInjection),
        sitesInjection: new SitesInjectionContextModule(sitesInjection),
        tasksInjection: new TasksInjectionContextModule(tasksInjection),
    });

    const [server, {start}] = TaskRealtimeServer.new(processContext);

    const startTime = Date.now();

    start(
        process.env.NODE_ENV === "production"
            ? wait(taskRealtimeServiceDiscoveryWaitMs)
            : // In development we only have one `TaskRealtimeService` instance and it's always
              // at the same port. It's always "discovered".
              Promise.resolve(),
    );

    // Sometimes we want to upgrade a session actor to a system actor. This gives the
    // action escalated the system permission level which is dangerous! The system
    // permission level has broad access to a space. We should tightly control what
    // code is allowed to call this function, only allowed context modules get access
    // and those context modules are expected to treat this as a private variable.
    //
    // It's important we use new caches + batchers here. We don't want to load some
    // data at a higher permission level then let the session context see it. So we
    // derive our new context from the process context to help avoid reusing any
    // request-level caches.
    //
    // NOTE(calebmer, 2023-08-07): May be worthwhile turning uses of this function into
    // RPC calls on another machine someday for security? Not sure if that helps.
    const dangerouslyEscalateToSystemContext = <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor: ActorContextModule;
            cache: CacheContextModule;
            batch: BatchContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: TaskRealtimeSystemActionContext) => Promise<Value>,
    ): Promise<Value> => {
        return processContext.with<
            Omit<
                TaskRealtimeSystemActionContextModules,
                Exclude<keyof TaskRealtimeProcessContextModules, "tracer"> | "opensearch"
            >,
            Value
        >(
            {
                tracer: new TracerContextModule(context.tracer.getTracer()),
                cache: context.cache.forkForChangedActor(),
                batch: context.batch.forkForChangedActor(),
                actor: SystemActorContextModule.dangerouslyNew(context.actor.serviceName, spaceId),
            },
            action,
        );
    };

    const webSocketServerBySpaceId = new DefaultMap(
        (spaceId: SpaceId) =>
            new WebSocketServer<
                TaskRealtimeProcessContextModules,
                TaskRealtimeSessionActionContextModules & {fork: ForkActionContextModule},
                typeof TaskRealtimeProtocol,
                // We don't need a custom stub type since `TaskRealtimeConnection` is already
                // designed to call `sendEvent()` on a per-connection basis with correct
                // permissions.
                TaskRealtimeEvent,
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
        url: URL,
        route: Exclude<TaskRealtimeServiceRoute, {type: "HealthCheck"} | {type: "NotFound"}>,
        span: TracerSpan,
    ): Promise<Response | void> => {
        const {spaceId} = route;

        const baseActionContext = processContext.clone({
            tracer: new TracerContextModule(span),
            cache: CacheContextModule.new(),
            batch: BatchContextModule.new(),
        });

        const actorContextModule = await createActorContextModuleFromAuthorizationHeader(
            baseActionContext,
            request.headers,
            tokenAgent,
            spaceId,
        );

        // Add identification information for the actor to all child spans.
        span.addPropagatedData(actorContextModule.getPropagatedData());

        switch (route.type) {
            case "Main": {
                // NOTE(calebmer): This condition is important for security! `TaskRealtimeService`
                // has routes to the public internet so our Cloudflare Worker `EdgeService` can
                // make a connection. However, ONLY `EdgeService` should be allowed to make
                // WebSocket connections. This check makes sure of that. Session cookies would use
                // an `AppClient` service name, you need access to `EdgeService`'s private key to
                // get past this check.
                if (actorContextModule.serviceName !== "EdgeService") {
                    throw new PermissionDeniedError("Only `EdgeService` can connect via WebSocket");
                }

                if (!(actorContextModule instanceof SessionActorContextModule)) {
                    throw new PermissionDeniedError(
                        "Only session actors can connect via WebSocket",
                    );
                }

                return baseActionContext.with(
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
            // This endpoint should be called every time an action transaction is commit in a
            // space that's part of this server's space partition. We add the actions to our
            // action history and broadcast realtime events to all connected clients.
            case "ApplyActionTransaction": {
                if (request.method !== "POST") {
                    throw new InvalidArgumentError(quote`Invalid request method ${request.method}`);
                }

                if (!(actorContextModule instanceof SystemActorContextModule)) {
                    throw new PermissionDeniedError("Only system actors can apply transactions");
                }

                return baseActionContext.with(
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

                const consistencySearchParam = url.searchParams.get("consistency");

                let consistency: DynamoCacheReadConsistency = "Eventual";

                if (consistencySearchParam !== null) {
                    switch (consistencySearchParam) {
                        case "Strong":
                        case "StrongWithinCache":
                            consistency = consistencySearchParam;
                            break;
                        default:
                            throw new InvalidArgumentError("Invalid `consistency` search param");
                    }
                }

                return baseActionContext.with(
                    {actor: actorContextModule},
                    async (context: TaskRealtimeActionContext) => {
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
                                consistency,
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

                const consistencySearchParam = url.searchParams.get("consistency");

                let consistency: DynamoCacheReadConsistency = "Eventual";

                if (consistencySearchParam !== null) {
                    switch (consistencySearchParam) {
                        case "Strong":
                        case "StrongWithinCache":
                            consistency = consistencySearchParam;
                            break;
                        default:
                            throw new InvalidArgumentError("Invalid `consistency` search param");
                    }
                }

                const output = await baseActionContext.with(
                    {actor: actorContextModule},
                    async (
                        context: TaskRealtimeActionContext,
                    ): Promise<TaskRealtimeGetTaskWithoutDependenciesOutput> => {
                        return getTaskWithoutDependenciesForRealtime(context, {
                            server,
                            dangerouslyEscalateToSystemContext,
                            spaceId,
                            taskId: route.taskId,
                            consistency,
                        });
                    },
                );

                return new Response(
                    JSON.stringify(
                        TaskRealtimeGetTaskWithoutDependenciesOutputSchema.serialize(output),
                    ),
                    {
                        status: 200,
                        headers: {"content-type": "application/json"},
                    },
                );
            }
            case "GetCollection": {
                if (request.method !== "GET") {
                    throw new InvalidArgumentError(quote`Invalid request method ${request.method}`);
                }

                const consistencySearchParam = url.searchParams.get("consistency");

                let consistency: DynamoCacheReadConsistency = "Eventual";

                if (consistencySearchParam !== null) {
                    switch (consistencySearchParam) {
                        case "Strong":
                        case "StrongWithinCache":
                            consistency = consistencySearchParam;
                            break;
                        default:
                            throw new InvalidArgumentError("Invalid `consistency` search param");
                    }
                }

                const output = await baseActionContext.with(
                    {actor: actorContextModule},
                    async (originalContext): Promise<TaskRealtimeGetCollectionOutput> => {
                        return getTaskCollectionForRealtime(originalContext, {
                            server,
                            dangerouslyEscalateToSystemContext,
                            spaceId,
                            collectionId: route.collectionId,
                            consistency,
                        });
                    },
                );

                return new Response(
                    JSON.stringify(TaskRealtimeGetCollectionOutputSchema.serialize(output)),
                    {
                        status: 200,
                        headers: {"content-type": "application/json"},
                    },
                );
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
                case "getCollection": {
                    if (pathnameSegments.length !== 3) return ["/*", {type: "NotFound"}];

                    if (!pathnameSegments[2] || !isId<TaskCollectionId>(pathnameSegments[2])) {
                        return ["/*", {type: "NotFound"}];
                    }

                    return [
                        "/:spaceId/getCollection/:collectionId",
                        {
                            type: "GetCollection",
                            spaceId,
                            collectionId: pathnameSegments[2],
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

            const result = await captureResultPromise(() =>
                handleRequest(request, url, route, span),
            );

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

                // If there was an error and the client was trying to connect to a WebSocket then
                // temporarily connect so we can send an error message over the WebSocket protocol
                // then immediately close.
                //
                // e.g. If there was an authorization error during durable object initialization.
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
                        // Cloudflare's WebSocket implementation doesn't fully comply with the TypeScript
                        // DOM WebSocket type (e.g. there is no `bufferedAmount` or `binaryType` property)
                        // but everything seems to be fine regardless.
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
