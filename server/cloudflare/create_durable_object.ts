import {
    WorkerActionContext,
    WorkerActionContextModules,
    WorkerSessionActionContext,
} from "~/server/cloudflare/context/worker_action_context.js";
import {createWorkerActorContextModule} from "~/server/cloudflare/context/worker_actor_context_module.js";
import {
    WorkerProcessContext,
    WorkerProcessContextModules,
} from "~/server/cloudflare/context/worker_process_context.js";
import {WorkerRpcContextModule} from "~/server/cloudflare/context/worker_rpc_context_module.js";
import {
    WebSocketServerConnectionBase,
    WebSocketServerTestConnection,
} from "~/server/cloudflare/web_socket_server.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {EdgeServiceFamilyTokenAgent} from "~/server/tokens/token_agent.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceFetchResponse} from "~/server/tracer/trace_fetch_response.js";
import {WebSocketProtocolBase} from "~/shared/cloudflare/web_socket_protocol.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {DurableObjectServiceName, TracerRoot} from "~/shared/tracer/tracer_root.js";

/**
 * Environment object provided to a Durable Object.
 */
export type DurableObjectEnv = {
    MyAccountDurableObjectNamespace: DurableObjectNamespace;
    APP_SERVICE_PUBLIC_KEY?: string;
    EDGE_SERVICE_FAMILY_PUBLIC_KEY?: string;
    EDGE_SERVICE_FAMILY_PRIVATE_KEY?: string;
    HONEYCOMB_API_KEY?: string;
};

/**
 * Create a Durable Object class for our system. Features:
 *
 * - Setting up `Context` objects. We have a `EdgeProcessContext` for the
 *   lifetime of the Durable Object and `EdgeActionContext`s for each individual
 *   request to the Durable Object.
 *
 * - Session authorization. Standardized protocol for sending user
 *   authorization credentials to the Durable Object.
 */
export function createDurableObject<
    DurableObject extends {
        fetch(context: WorkerActionContext, request: Request): MaybePromise<Response>;
        connectForTest?(
            context: WorkerActionContext,
        ): Promise<
            WebSocketServerTestConnection<WebSocketProtocolBase, WebSocketServerConnectionBase<any>>
        >;
    },
>({
    serviceName,
    initialize,
}: {
    serviceName: DurableObjectServiceName;
    initialize: (options: {
        processContext: WorkerProcessContext;
        initializeActionContext: WorkerActionContext;
        idName: string;
        destroy: () => void;
    }) => Promise<DurableObject>;
}): {
    new (state: DurableObjectState, env: DurableObjectEnv): {
        fetch(request: Request): Promise<Response>;
        alarm?(): Promise<void>;
    };
    test(context: WorkerProcessContext): {
        connectForTest: (
            context: WorkerSessionActionContext,
            idName: string,
        ) => Promise<ReturnType<NonNullable<DurableObject["connectForTest"]>>>;
    };
} {
    return class DurableObjectWrapper {
        private readonly _state: DurableObjectState;
        private _tokenAgent: EdgeServiceFamilyTokenAgent | Promise<EdgeServiceFamilyTokenAgent>;
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

            const edgeServiceFamilyPrivateKey = env.EDGE_SERVICE_FAMILY_PRIVATE_KEY;
            if (!edgeServiceFamilyPrivateKey)
                throw new InternalError("Missing `EDGE_SERVICE_FAMILY_PRIVATE_KEY` env variable");

            const tokenAgentPromise = EdgeServiceFamilyTokenAgent.new({
                serviceName,
                appServicePublicKey,
                edgeServiceFamilyPublicKey,
                edgeServiceFamilyPrivateKey,
            });

            this._tokenAgent = tokenAgentPromise;

            // When the token agent has resolved, we don't need to await it anymore.
            void tokenAgentPromise.then(tokenAgent => (this._tokenAgent = tokenAgent));

            this._tracer = createServerTracer({
                serviceName,
                honeycombApiKey: env.HONEYCOMB_API_KEY,
                waitUntil: promise => state.waitUntil(promise),
            });

            this._processContext = Context.new({
                process: new ProcessContextModule({
                    waitUntil: promise =>
                        this._state.waitUntil(
                            // Don't crash the process when there's an uncaught promise exception in
                            // `waitUntil()` but definitely log it.
                            promise.catch(error => {
                                // eslint-disable-next-line no-console
                                if (process.env.NODE_ENV !== "production") console.error(error);

                                this._tracer.logUncaughtException(
                                    "Uncaught exception in `waitUntil()`",
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

            return traceFetchResponse(this._tracer, request, url, async (span, request) => {
                try {
                    const authorizationHeader = request.headers.get("authorization");
                    if (!authorizationHeader) throw unauthenticatedSessionError();
                    const authorizationHeaderMatch = authorizationHeader.match(/^bearer (.+)$/i);

                    if (!authorizationHeaderMatch) {
                        throw new InvalidArgumentError(
                            'Expected "Authorization" header to have "Bearer" authentication scheme',
                        );
                    }

                    const authorizationHeaderToken = authorizationHeaderMatch[1] ?? "";

                    const tokenAgent =
                        this._tokenAgent instanceof Promise
                            ? await this._tokenAgent
                            : this._tokenAgent;

                    const response = await this._processContext.with<
                        Omit<
                            WorkerActionContextModules,
                            Exclude<keyof WorkerProcessContextModules, "tracer">
                        >,
                        Response
                    >(
                        {
                            // Replace the tracer context module with one that uses our span for
                            // this request.
                            tracer: new TracerContextModule(span),
                            cache: new CacheContextModule(),
                            actor: await createWorkerActorContextModule(
                                tokenAgent,
                                authorizationHeaderToken,
                            ),
                            rpc: new WorkerRpcContextModule({
                                protocol: url.protocol,
                                host: url.host,
                                tokenAgent,
                            }),
                        },
                        async actionContext => {
                            const idName = request.headers.get("cyberworlds-id-name");
                            if (idName === null)
                                throw new InvalidArgumentError(
                                    "Expected Durable Object ID name to be included in header",
                                );

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
                            }

                            if (idName !== this._object.idName)
                                throw new FailedPreconditionError(
                                    "Durable Object ID name in header does not match the ID name we initialized with",
                                );

                            const object = await this._object.promise;

                            return object.fetch(actionContext, request);
                        },
                    );
                    return response;
                } catch (error) {
                    span.addException(error);
                    const status = isSystemError(error) ? 500 : 400;
                    const response = new Response(null, {status});
                    return response;
                }
            });
        }

        /**
         * Creates a durable object environment for use in Jest tests. Whenever you
         * call `connectForTest()` on the returned object with the same `idName` you
         * will get the same underlying durable object instance.
         */
        public static test(processContext: WorkerProcessContext): {
            connectForTest: (
                context: WorkerSessionActionContext,
                idName: string,
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
                connectForTest: async (actionContext, idName) => {
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

                    const connection = (await object.connectForTest(actionContext)) as Awaited<
                        ReturnType<NonNullable<DurableObject["connectForTest"]>>
                    >;

                    connections.push(connection);

                    return connection;
                },
            };
        }
    };
}
