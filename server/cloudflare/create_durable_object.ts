import {jwtVerify} from "jose";
import {createAwsContextModulesFromEnv} from "~/server/aws/create_aws_context_modules_from_env.js";
import {
    WebSocketServerConnectionBase,
    WebSocketServerTestConnection,
} from "~/server/cloudflare/web_socket_server.js";
import {Session} from "~/server/dynamo/accounts_table.js";
import {
    ActionContext,
    ActionContextModules,
    SessionActionContext,
} from "~/server/dynamo/context/action_context.js";
import {
    ActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
    UnidentifiedActorContextModule,
} from "~/server/dynamo/context/actor_context_module.js";
import {unauthenticatedSessionError} from "~/server/dynamo/context/helpers/unauthenticated_session_error.js";
import {NotificationsContextModule} from "~/server/dynamo/context/notifications_context_module.js";
import {
    ProcessContext,
    ProcessContextModulesBase,
} from "~/server/dynamo/context/process_context.js";
import {DynamoBatchContextModule} from "~/server/dynamo/dynamo_context_module.js";
import {Queue} from "~/server/helpers/types/cloudflare_queues.js";
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
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema.js";
import {DurableObjectServiceName, TracerRoot} from "~/shared/tracer/tracer_root.js";

/**
 * Environment object provided to a Durable Object.
 */
export type DurableObjectEnv = {
    MyAccountDurableObjectNamespace: DurableObjectNamespace;
    NotificationsQueue: Queue;
    DYNAMO_LOCAL_PORT?: string;
    SESSION_COOKIE_SECRET?: string;
    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
    HONEYCOMB_API_KEY?: string;
};

/**
 * Create a Durable Object class for our system. Features:
 *
 * - Setting up `Context` objects. We have a `ProcessContext` for the lifetime
 *   of the Durable Object and `ActionContext`s for each individual request to
 *   the Durable Object.
 *
 * - Session authorization. Standardized protocol for sending user
 *   authorization credentials to the Durable Object.
 */
export function createDurableObject<
    DurableObject extends {
        fetch(context: ActionContext, request: Request): MaybePromise<Response>;
        connectForTest?(
            context: SessionActionContext,
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
        processContext: ProcessContext;
        initializeActionContext: ActionContext;
        idName: string;
        destroy: () => void;
    }) => Promise<DurableObject>;
}): {
    new (state: DurableObjectState, env: DurableObjectEnv): {
        fetch(request: Request): Promise<Response>;
        alarm?(): Promise<void>;
    };
    test(context: ProcessContext): {
        connectForTest: (
            context: SessionActionContext,
            idName: string,
        ) => Promise<ReturnType<NonNullable<DurableObject["connectForTest"]>>>;
    };
} {
    return class DurableObjectWrapper {
        private readonly _state: DurableObjectState;
        private readonly _sessionCookieSecret: string;
        private readonly _tracer: TracerRoot;
        private readonly _processContextModulesBase: ProcessContextModulesBase;
        private readonly _processContext: ProcessContext;
        private _object: {
            readonly idName: string;
            readonly promise: Promise<DurableObject>;
        } | null = null;

        constructor(state: DurableObjectState, env: DurableObjectEnv) {
            this._state = state;

            const sessionCookieSecret = env.SESSION_COOKIE_SECRET;
            if (!sessionCookieSecret)
                throw new InternalError("Missing `SESSION_COOKIE_SECRET` environment variable");

            this._sessionCookieSecret = sessionCookieSecret;

            this._tracer = createServerTracer({
                serviceName,
                env,
                waitUntil: promise => state.waitUntil(promise),
            });

            const awsContextModules = createAwsContextModulesFromEnv(env);

            this._processContextModulesBase = {
                ...awsContextModules,
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
                notifications: new NotificationsContextModule(env),
            };

            this._processContext = Context.new({
                ...this._processContextModulesBase,
                actor: new UnidentifiedActorContextModule(),
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

                    const authenticationToken = authorizationHeaderMatch[1] ?? "";

                    const verifiedAuthenticationToken = await this._verifyAuthenticationToken(
                        authenticationToken,
                    );

                    let actor: ActorContextModule;
                    switch (verifiedAuthenticationToken.type) {
                        case "Session": {
                            const session = await Session.getIfExists(
                                this._processContext.clone({tracer: new TracerContextModule(span)}),
                                verifiedAuthenticationToken.sessionId,
                                verifiedAuthenticationToken.sessionAccountId ?? null,
                            );
                            if (!session) {
                                throw new InternalError(
                                    'Could not find session from "Authorization" header',
                                );
                            }

                            actor = new SessionActorContextModule(session);
                            break;
                        }
                        case "System": {
                            actor = new SystemActorContextModule(
                                verifiedAuthenticationToken.spaceId,
                            );
                            break;
                        }
                        default:
                            throw exhaustive(verifiedAuthenticationToken);
                    }

                    const response = await Context.with<ActionContextModules, Response>(
                        {
                            ...this._processContextModulesBase,
                            // Replace the tracer context module with one that uses our span for
                            // this request.
                            tracer: new TracerContextModule(span),
                            cache: new CacheContextModule(),
                            dynamoBatchContext: new DynamoBatchContextModule(),
                            actor,
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
                                    promise: initialize({
                                        processContext: this._processContext,
                                        initializeActionContext: actionContext,
                                        idName,
                                        destroy: () => (this._object = null),
                                    }),
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

        private async _verifyAuthenticationToken(token: string) {
            const {payload} = await jwtVerify(
                token,
                new TextEncoder().encode(this._sessionCookieSecret),
            );
            return DurableObjectAuthenticationTokenSchema.deserialize(
                payload as SchemaSerializedValue,
            );
        }

        /**
         * Creates a durable object environment for use in Jest tests. Whenever you
         * call `connectForTest()` on the returned object with the same `idName` you
         * will get the same underlying durable object instance.
         */
        public static test(processContext: ProcessContext): {
            connectForTest: (
                context: SessionActionContext,
                idName: string,
            ) => Promise<ReturnType<NonNullable<DurableObject["connectForTest"]>>>;
        } {
            assert(typeof jest !== "undefined");

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

const DurableObjectAuthenticationTokenSchema = Schema.union({
    Session: Schema.object({
        type: Schema.value("Session"),
        sessionId: Schema.id<SessionId>(),
        sessionAccountId: Schema.id<AccountId>().optional(),
    }),
    System: Schema.object({
        type: Schema.value("System"),
        spaceId: Schema.id<SpaceId>(),
    }),
});
