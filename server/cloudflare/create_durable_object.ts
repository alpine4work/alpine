import {
    WorkerActionContext,
    WorkerActionContextModules,
    WorkerSessionActionContext,
    WorkerSessionActionContextModules,
} from "~/server/cloudflare/context/worker_action_context.js";
import {
    WorkerProcessContext,
    WorkerProcessContextModules,
} from "~/server/cloudflare/context/worker_process_context.js";
import {
    WorkerRpcContextBatcher,
    WorkerRpcContextModule,
} from "~/server/cloudflare/context/worker_rpc_context_module.js";
import {
    ActorContextModule,
    AnonymousActorContextModule,
    BotActorContextModule,
    ImpersonatedAccountActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentPrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {TokenAgentPublicSide} from "~/server/tokens/token_agent_public_side.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {
    WebSocketServerConnectionBase,
    WebSocketServerTestConnection,
} from "~/server/web_socket/web_socket_server.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {CookieJar} from "~/shared/helpers/http/cookie_jar.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {DurableObjectServiceName, TracerRoot} from "~/shared/tracer/tracer_root.js";
import {WebSocketProtocolBase} from "~/shared/web_socket/web_socket_protocol.js";
import {WebSocketClosingWithErrorMessageSchema} from "~/shared/web_socket/web_socket_schema.js";

/**
 * Environment object provided to a Durable Object.
 */
export type DurableObjectEnv = {
    APP_SERVICE_PUBLIC_KEY?: string;
    EDGE_SERVICE_FAMILY_PUBLIC_KEY?: string;
    TASK_REALTIME_SERVICE_PUBLIC_KEY?: string;
    JOB_QUEUE_SERVICE_PUBLIC_KEY?: string;
    FILE_PROCESSOR_SERVICE_PUBLIC_KEY?: string;
    RESOURCE_SERVICE_PUBLIC_KEY?: string;
    API_SERVICE_PUBLIC_KEY?: string;
    IMPORTER_SERVICE_PUBLIC_KEY?: string;
    EDGE_SERVICE_FAMILY_PRIVATE_KEY?: string;
    TOKEN_AGENT_SECRET?: string;
    HONEYCOMB_API_KEY?: string;

    // Kinesis configuration for tracer event archival. Only required in production.
    KINESIS_TRACER_STREAM_NAME?: string;
    KINESIS_AWS_ACCESS_KEY_ID?: string;
    KINESIS_AWS_SECRET_ACCESS_KEY?: string;
};

/**
 * Create a Durable Object class for our system. Features:
 *
 * - Setting up `Context` objects. We have a `EdgeProcessContext` for the lifetime
 *   of the Durable Object and `EdgeActionContext`s for each individual request to
 *   the Durable Object.
 *
 * - Session authorization. Standardized protocol for sending user authorization
 *   credentials to the Durable Object.
 */
export function createDurableObject<
    Route,
    DurableObject extends {
        fetch(context: WorkerActionContext, request: Request, route: Route): MaybePromise<Response>;
        connectForTest?(
            context: WorkerSessionActionContext,
            options?: object,
        ): Promise<
            WebSocketServerTestConnection<
                WorkerProcessContextModules,
                WorkerSessionActionContextModules,
                WebSocketProtocolBase,
                any,
                WebSocketServerConnectionBase<
                    WorkerProcessContextModules,
                    WorkerSessionActionContextModules,
                    any,
                    any
                >
            >
        >;
    },
>({
    serviceName,
    parseRoute,
    initialize,
}: {
    serviceName: DurableObjectServiceName;
    parseRoute: (url: URL) => [string, Route];
    initialize: (options: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
        destroy: () => void;
    }) => Promise<DurableObject>;
}): {
    new (
        state: DurableObjectState,
        env: DurableObjectEnv,
    ): {
        fetch(request: Request): Promise<Response>;
        alarm?(): Promise<void>;
    };
    test(context: WorkerProcessContext): {
        fetchForTest: (
            context: WorkerActionContext,
            idName: string,
            request: Request,
        ) => Promise<Response>;
        connectForTest: (
            context: WorkerSessionActionContext,
            idName: string,
            options?: Parameters<NonNullable<DurableObject["connectForTest"]>>[1],
        ) => Promise<ReturnType<NonNullable<DurableObject["connectForTest"]>>>;
    };
} {
    return class DurableObjectWrapper {
        private readonly _state: DurableObjectState;
        private readonly _cookieJar: CookieJar;
        private _tokenAgent: TokenAgent | Promise<TokenAgent>;
        private _rpcBatcher: WorkerRpcContextBatcher | null = null;
        private readonly _tracer: TracerRoot;
        private readonly _processContext: WorkerProcessContext;
        private _object: {
            readonly idName: string;
            readonly promise: Promise<DurableObject>;
        } | null = null;

        constructor(state: DurableObjectState, env: DurableObjectEnv) {
            this._state = state;

            const appServicePublicKey = env.APP_SERVICE_PUBLIC_KEY;
            if (!appServicePublicKey)
                throw new InternalError("Missing `APP_SERVICE_PUBLIC_KEY` env variable");

            const edgeServiceFamilyPublicKey = env.EDGE_SERVICE_FAMILY_PUBLIC_KEY;
            if (!edgeServiceFamilyPublicKey)
                throw new InternalError("Missing `EDGE_SERVICE_FAMILY_PUBLIC_KEY` env variable");

            const taskRealtimeServicePublicKey = env.TASK_REALTIME_SERVICE_PUBLIC_KEY;
            if (!taskRealtimeServicePublicKey)
                throw new InternalError("Missing `TASK_REALTIME_SERVICE_PUBLIC_KEY` env variable");

            const jobQueueServicePublicKey = env.JOB_QUEUE_SERVICE_PUBLIC_KEY;
            if (!jobQueueServicePublicKey)
                throw new InternalError("Missing `JOB_QUEUE_SERVICE_PUBLIC_KEY` env variable");

            const fileProcessorServicePublicKey = env.FILE_PROCESSOR_SERVICE_PUBLIC_KEY;
            if (!fileProcessorServicePublicKey)
                throw new InternalError("Missing `FILE_PROCESSOR_SERVICE_PUBLIC_KEY` env variable");

            const resourceServicePublicKey = env.RESOURCE_SERVICE_PUBLIC_KEY;
            if (!resourceServicePublicKey)
                throw new InternalError("Missing `RESOURCE_SERVICE_PUBLIC_KEY` env variable");

            const apiServicePublicKey = env.API_SERVICE_PUBLIC_KEY;
            if (!apiServicePublicKey)
                throw new InternalError("Missing `API_SERVICE_PUBLIC_KEY` env variable");

            const importerServicePublicKey = env.IMPORTER_SERVICE_PUBLIC_KEY;
            if (!importerServicePublicKey)
                throw new InternalError("Missing `IMPORTER_SERVICE_PUBLIC_KEY` env variable");

            const edgeServiceFamilyPrivateKey = env.EDGE_SERVICE_FAMILY_PRIVATE_KEY;
            if (!edgeServiceFamilyPrivateKey)
                throw new InternalError("Missing `EDGE_SERVICE_FAMILY_PRIVATE_KEY` env variable");

            const tokenAgentSecret = env.TOKEN_AGENT_SECRET;
            if (!tokenAgentSecret)
                throw new InternalError("Missing `TOKEN_AGENT_SECRET` env variable");

            // Cookie jar for sharing cookies across requests made from this Durable Object
            // instance.
            this._cookieJar = new CookieJar();

            const tokenAgentPromise = runAllPromises([
                TokenAgentPublicSide.new({
                    serviceName,
                    appServicePublicKey,
                    edgeServiceFamilyPublicKey,
                    taskRealtimeServicePublicKey,
                    jobQueueServicePublicKey,
                    fileProcessorServicePublicKey,
                    resourceServicePublicKey,
                    apiServicePublicKey,
                    importerServicePublicKey,
                    secret: tokenAgentSecret,
                }),
                TokenAgentPrivateSide.new({
                    serviceName,
                    servicePrivateKey: edgeServiceFamilyPrivateKey,
                    secret: tokenAgentSecret,
                }),
            ]).then(([publicSide, privateSide]) => ({publicSide, privateSide}));

            this._tokenAgent = tokenAgentPromise;

            // When the token agent has resolved, we don't need to await it anymore.
            void tokenAgentPromise.then(tokenAgent => (this._tokenAgent = tokenAgent));

            // TODO(ifitzsimmons, #local-kinesis): This will eventually be required. For now,
            // there is no local Kinesis stream so we don't need to pass in a stream name.
            const streamName = env.KINESIS_TRACER_STREAM_NAME;
            if (!streamName && process.env.NODE_ENV === "production")
                throw new InternalError("Must provide `KINESIS_TRACER_STREAM_NAME` in production");

            this._tracer = createServerTracer({
                serviceName,
                jsHost: "CloudflareWorker",
                honeycombApiKey: env.HONEYCOMB_API_KEY,
                honeycombDataset: "tracer",
                waitUntil: promise => state.waitUntil(promise),
                // TODO(ifitzsimmons, #local-kinesis): This will eventually be required. For now,
                // there is no local Kinesis stream so we don't need to pass in a stream name.
                kinesisTracerStreamOptions: streamName
                    ? {
                          streamName,
                          awsSigner: new AwsRequestSigner({
                              accessKeyId: assertExists(
                                  env.KINESIS_AWS_ACCESS_KEY_ID,
                                  "`KINESIS_AWS_ACCESS_KEY_ID` is required",
                              ),
                              secretAccessKey: assertExists(
                                  env.KINESIS_AWS_SECRET_ACCESS_KEY,
                                  "`KINESIS_AWS_SECRET_ACCESS_KEY` is required",
                              ),
                          }),
                      }
                    : undefined,
            });

            this._processContext = Context.new({
                process: new ProcessContextModule({
                    waitUntil: promise =>
                        this._state.waitUntil(
                            promise.catch(error => {
                                this._tracer.logException(
                                    "Uncaught exception from `waitUntil()`",
                                    error,
                                );
                            }),
                        ),
                }),
                tracer: new TracerContextModule(this._tracer),
            });
        }

        public fetch(request: Request): Promise<Response> {
            const url = new URL(request.url);

            const [route, routeObject] = parseRoute(url);

            return traceServerResponse(this._tracer, request, url, route, async (span, request) => {
                try {
                    const idName = request.headers.get("cyberworlds-durable-object-id-name");
                    if (idName === null)
                        throw new InvalidArgumentError(
                            "Expected Durable Object ID name to be included in header",
                        );

                    // Clients may make requests conditional on the Durable Object being initialized.
                    // Ideally this logic would happen at the Cloudflare level instead of our
                    // application code but it's still useful here as it prevents network requests made
                    // while initializing.
                    if (
                        request.headers.get("cyberworlds-durable-object-if-initialized") ===
                            "true" &&
                        this._object === null
                    ) {
                        return new Response("412 Precondition Failed", {
                            status: 412,
                            headers: {"content-type": "text/plain"},
                        });
                    }

                    const authorizationHeader = request.headers.get("authorization");
                    if (!authorizationHeader) throw unauthenticatedSessionError();
                    const authorizationHeaderMatch = authorizationHeader.match(/^bearer (.+)$/i);

                    if (!authorizationHeaderMatch) {
                        throw new InvalidArgumentError(
                            "Expected `Authorization` header to have `Bearer` authentication scheme",
                        );
                    }

                    const authorizationHeaderToken = authorizationHeaderMatch[1] ?? "";

                    const tokenAgent =
                        this._tokenAgent instanceof Promise
                            ? await this._tokenAgent
                            : this._tokenAgent;

                    this._rpcBatcher ??= new WorkerRpcContextBatcher({
                        protocol: url.protocol,
                        host: url.host,
                        tokenAgent,
                        cookieJar: this._cookieJar,
                    });

                    const actorContextModule = await createDurableObjectActorContextModule(
                        tokenAgent,
                        authorizationHeaderToken,
                    );

                    // Add identification information for the actor to all child spans.
                    span.addPropagatedData(actorContextModule.getPropagatedData());

                    const response = await this._processContext.with<
                        Omit<
                            WorkerActionContextModules,
                            Exclude<keyof WorkerProcessContextModules, "tracer">
                        >,
                        Response
                    >(
                        {
                            // Replace the tracer context module with one that uses our span for this request.
                            tracer: new TracerContextModule(span),
                            cache: CacheContextModule.new(),
                            batch: BatchContextModule.new(),
                            actor: actorContextModule,
                            rpc: new WorkerRpcContextModule(this._rpcBatcher),
                            fork: new ForkActionContextModule(),
                        },
                        async actionContext => {
                            if (this._object === null) {
                                this._object = {
                                    idName,
                                    promise: actionContext.tracer.withSpan(
                                        "Initialize Durable Object",
                                        actionContext =>
                                            initialize({
                                                processContext: this._processContext,
                                                initializeActionContext: actionContext,
                                                idName,
                                                destroy: () => (this._object = null),
                                            }),
                                    ),
                                };

                                // If we fail to initialize then kill the durable object. Next request should
                                // attempt to initialize it again.
                                this._object.promise.catch(() => {
                                    this._object = null;
                                });
                            }

                            if (idName !== this._object.idName)
                                throw new FailedPreconditionError(
                                    "Durable Object ID name in header does not match the ID name we initialized with",
                                );

                            const object = await this._object.promise;

                            return object.fetch(actionContext, request, routeObject);
                        },
                    );
                    return response;
                } catch (error) {
                    span.addException(error);

                    // If there was an error and the client was trying to connect to a WebSocket then
                    // temporarily connect so we can send an error message over the WebSocket protocol
                    // then immediately close.
                    //
                    // e.g. If there was an authorization error during durable object initialization.
                    if (request.headers.get("upgrade") !== "websocket") {
                        return createSimpleErrorResponse(error);
                    } else {
                        const socketPair = new WebSocketPair();
                        const clientSocket = socketPair[0];
                        const serverSocket = socketPair[1];

                        const response = new Response(null, {
                            status: 101,
                            webSocket: clientSocket,
                        });

                        (serverSocket as any).accept();

                        serverSocket.send(
                            JSON.stringify(
                                WebSocketClosingWithErrorMessageSchema.serialize({
                                    type: "ClosingWithError",
                                    error,
                                }),
                            ),
                        );

                        serverSocket.close();

                        return response;
                    }
                }
            });
        }

        /**
         * Creates a durable object environment for use in Jest tests. Whenever you call
         * `connectForTest()` on the returned object with the same `idName` you will get
         * the same underlying durable object instance.
         */
        public static test(processContext: WorkerProcessContext): {
            fetchForTest: (
                context: WorkerActionContext,
                idName: string,
                request: Request,
            ) => Promise<Response>;
            connectForTest: (
                context: WorkerSessionActionContext,
                idName: string,
                options?: Parameters<NonNullable<DurableObject["connectForTest"]>>[1],
            ) => Promise<ReturnType<NonNullable<DurableObject["connectForTest"]>>>;
        } {
            assert(import.meta.jest);

            const objectByIdName = new Map<string, Promise<DurableObject>>();
            let connections: Array<
                Awaited<ReturnType<NonNullable<DurableObject["connectForTest"]>>>
            > = [];

            afterEach(() => {
                const lastConnections = connections;
                connections = [];
                for (const connection of lastConnections) connection.close();

                objectByIdName.clear();
            });

            return {
                fetchForTest: async (actionContext, idName, request) => {
                    const url = new URL(request.url);

                    const [, route] = parseRoute(url);

                    const object = await getOrSetDefaultMapValue(objectByIdName, idName, () =>
                        initialize({
                            processContext,
                            initializeActionContext: actionContext,
                            idName,
                            destroy: () => objectByIdName.delete(idName),
                        }),
                    );

                    return object.fetch(actionContext, request, route);
                },
                connectForTest: async (actionContext, idName, options) => {
                    const object = await getOrSetDefaultMapValue(objectByIdName, idName, () =>
                        initialize({
                            processContext,
                            initializeActionContext: actionContext,
                            idName,
                            destroy: () => objectByIdName.delete(idName),
                        }),
                    );

                    if (!object.connectForTest)
                        throw new UnimplementedError(
                            "Underlying durable object must implement `connectForTest()`",
                        );

                    const connection = (await object.connectForTest(
                        actionContext,
                        options,
                    )) as Awaited<ReturnType<NonNullable<DurableObject["connectForTest"]>>>;

                    connections.push(connection);

                    return connection;
                },
            };
        }
    };
}

/**
 * Verify the token and return an actor context module corresponding to the token.
 */
async function createDurableObjectActorContextModule(
    tokenAgent: TokenAgent,
    token: string,
): Promise<ActorContextModule> {
    const {serviceName, payload} = await tokenAgent.publicSide.verifyToken(token);

    switch (payload.type) {
        case "Session": {
            // The tokens provided to Durable Objects are short lived. So we don't check if the
            // session was revoked. If the session was valid when the token was signed we trust
            // it's still valid now.
            //
            // If we make an RPC call then `AppService` will check it the session was revoked.
            return SessionActorContextModule.dangerouslyNewWithoutCheckingIfRevoked(
                serviceName,
                payload.sessionId,
                payload.accountId,
            );
        }
        case "System": {
            return SystemActorContextModule.dangerouslyNew(serviceName, payload.spaceId);
        }
        case "ImpersonatedAccount": {
            return ImpersonatedAccountActorContextModule.dangerouslyNew(
                SystemActorContextModule.dangerouslyNew(serviceName, payload.spaceId),
                payload.accountId,
            );
        }
        case "Anonymous": {
            return AnonymousActorContextModule.dangerouslyNew(serviceName);
        }
        case "Bot": {
            return BotActorContextModule.dangerouslyNew(
                serviceName,
                payload.spaceId,
                payload.accountId,
                payload.scope,
            );
        }
        default:
            throw exhaustive(payload);
    }
}
