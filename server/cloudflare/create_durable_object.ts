import {jwtVerify} from "jose";
import {createAwsContextModulesFromEnv} from "~/server/aws/create_aws_context_modules_from_env";
import {Session} from "~/server/dynamo/accounts_table";
import {UnauthenticatedAuthContextModule} from "~/server/dynamo/context/auth_context_module";
import {ProcessContext, ProcessContextModules} from "~/server/dynamo/context/process_context";
import {
    RequestContext,
    UnauthenticatedRequestContextModules,
} from "~/server/dynamo/context/request_context";
import {createServerTracer} from "~/server/tracer/server_tracer";
import {traceFetchResponse} from "~/server/tracer/trace_fetch_response";
import {CacheContextModule} from "~/shared/context/cache_context_module";
import {Context} from "~/shared/context/context";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
} from "~/shared/error/error";
import {isSystemError} from "~/shared/error/is_system_error_code";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise";
import {AccountId, SessionId} from "~/shared/id/types/id_types";
import {Schema, SchemaSerializedValue} from "~/shared/schema/schema";
import {DurableObjectServiceName, TracerRoot} from "~/shared/tracer/tracer_root";

/**
 * Environment object provided to a Durable Object.
 */
export type DurableObjectEnv = {
    LOCAL_DYNAMO_PORT?: string;
    SESSION_COOKIE_SECRET?: string;
    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
    HONEYCOMB_API_KEY?: string;
};

/**
 * Create a Durable Object class for our system. Features:
 *
 * - Setting up `Context` objects. We have a `ProcessContext` for the lifetime
 *   of the Durable Object and `RequestContext`s for each individual request to
 *   the Durable Object.
 *
 * - Session authorization. Standardized protocol for sending user
 *   authorization credentials to the Durable Object.
 */
export function createDurableObject<
    DurableObject extends {
        fetch(context: RequestContext, request: Request): MaybePromise<Response>;
    },
>({
    serviceName,
    initialize,
}: {
    serviceName: DurableObjectServiceName;
    initialize: (options: {
        processContext: ProcessContext;
        initializeRequestContext: RequestContext;
        idName: string;
        destroy: () => void;
    }) => Promise<DurableObject>;
}): {
    new (state: DurableObjectState, env: DurableObjectEnv): {
        fetch(request: Request): Promise<Response>;
        alarm?(): Promise<void>;
    };
} {
    return class DurableObjectWrapper {
        private readonly _state: DurableObjectState;
        private readonly _sessionCookieSecret: string;
        private readonly _tracer: TracerRoot;
        private readonly _context: ProcessContext;
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

            this._context = Context.new({
                ...awsContextModules,
                process: new ProcessContextModule({
                    waitUntil: promise => this._state.waitUntil(promise),
                }),
                tracer: new TracerContextModule(this._tracer),
            });
        }

        public fetch(request: Request): Promise<Response> {
            const url = new URL(request.url);

            return traceFetchResponse(this._tracer, request, url, async (span, request) => {
                try {
                    const response = await this._context.with<
                        Omit<
                            UnauthenticatedRequestContextModules,
                            Exclude<keyof ProcessContextModules, "tracer">
                        >,
                        Response
                    >(
                        {
                            // Replace the tracer context module with one that uses our span for
                            // this request.
                            tracer: new TracerContextModule(span),
                            cache: new CacheContextModule(),

                            auth: new UnauthenticatedAuthContextModule(async context => {
                                const authorizationHeader = request.headers.get("authorization");
                                if (!authorizationHeader) return null;
                                const authorizationHeaderMatch =
                                    authorizationHeader.match(/^bearer (.+)$/i);

                                if (!authorizationHeaderMatch)
                                    throw new InvalidArgumentError(
                                        'Expected "Authorization" header to have "Bearer" authentication scheme',
                                    );

                                const authenticationToken = authorizationHeaderMatch[1] ?? "";

                                const {sessionId, sessionAccountId} =
                                    await this._verifyAuthenticationToken(authenticationToken);

                                const session = await Session.get(
                                    context,
                                    sessionId,
                                    sessionAccountId ?? null,
                                );
                                if (!session)
                                    throw new NotFoundError(
                                        'Could not find session from "Authorization" header',
                                    );

                                return session;
                            }),
                        },
                        async _requestContext => {
                            const requestContext: RequestContext =
                                await _requestContext.auth.authenticate();

                            const idName = request.headers.get("cyberworlds-id-name");
                            if (idName === null)
                                throw new InvalidArgumentError(
                                    "Expected Durable Object ID name to be included in header",
                                );

                            if (this._object === null) {
                                this._object = {
                                    idName,
                                    promise: initialize({
                                        processContext: this._context,
                                        initializeRequestContext: requestContext,
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

                            return object.fetch(requestContext, request);
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
    };
}

const DurableObjectAuthenticationTokenSchema = Schema.object({
    sessionId: Schema.id<SessionId>(),
    sessionAccountId: Schema.id<AccountId>().optional(),
});
