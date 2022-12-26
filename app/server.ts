import {AppLoadContext} from "@remix-run/cloudflare";
import {createRequestHandler, handleAsset} from "@remix-run/cloudflare-workers";
import * as build from "@remix-run/dev/server-build";
import {SignJWT} from "jose";
import {UnauthenticatedAuthContextModule} from "~/server/context/auth_context_module";
import {AwsContextModule} from "~/server/context/aws_context_module";
import {createAwsClientFromEnv} from "~/server/context/helpers/create_aws_client_from_env";
import {unauthenticatedSessionError} from "~/server/context/helpers/unauthenticated_session_error";
import {Session} from "~/server/dynamo/accounts_table";
import {LoadContext, LoadContextModules} from "~/server/helpers/remix/data_function_args";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module";
import {SessionCookieStorage} from "~/server/session/session_cookie";
import {SessionCookieContextModule} from "~/server/session/session_cookie_context_module";
import {traceFetchResponse} from "~/server/tracer/trace_fetch_response";
import {Context} from "~/shared/context/context";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {InternalError} from "~/shared/error/error";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {Schema} from "~/shared/schema/schema";
import {Tracer} from "~/shared/tracer/tracer";

type AppWorkerEnv = {
    DocumentCollaborationDurableObjectNamespace: DurableObjectNamespace;
    SESSION_COOKIE_SECRET?: string;
    AWS_SECRET_ACCESS_KEY?: string;
    AWS_ACCESS_KEY_ID?: string;
    ABLY_API_KEY?: string;
    __STATIC_CONTENT?: string;
};

const contextSymbol = Symbol("context");

const handleRequest = createRequestHandler({
    build,
    getLoadContext(event: FetchEvent & {[contextSymbol]?: LoadContext}) {
        const context = assertExists(event[contextSymbol]);
        return context as any as AppLoadContext;
    },
});

let sharedTracer: Tracer | null = null;

// Cache some shared resources across requests.
let sharedResources: {
    env: AppWorkerEnv;
    sessionCookieSecret: string;
    sessionCookieStorage: SessionCookieStorage;
    awsContextModule: AwsContextModule;
} | null = null;

// See: https://github.com/cloudflare/wrangler/pull/2126
const staticContentManifestPromise =
    process.env.NODE_ENV === "production"
        ? import("__STATIC_CONTENT_MANIFEST").then(manifestJson => JSON.parse(manifestJson.default))
        : null;

async function fetch(
    request: Request,
    env: AppWorkerEnv,
    executionContext: ExecutionContext,
): Promise<Response> {
    if (sharedTracer === null) {
        sharedTracer = Tracer.new({
            serviceName: "AppServer",
            jsHost: "CloudflareWorker",
            // In Cloudflare Workers, `Date.now()` only moves forward on I/O as a part of
            // their security model. This means timers won't be perfectly accurate.
            // https://developers.cloudflare.com/workers/learning/security-model
            getTime: () => Date.now(),
            sendEvent: event => {
                // TODO(calebmer): Implement!
                // eslint-disable-next-line no-console
                console.log({
                    time: event.time,
                    data: event.getFlatData(),
                });
            },
        });
    }
    const tracer = sharedTracer;

    // An env object that is referentially equal will be passed in as long as
    // environment variables remain the same.
    // https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#parameters
    if (sharedResources === null || sharedResources.env !== env) {
        const sessionCookieSecret =
            env.SESSION_COOKIE_SECRET ?? (process.env.NODE_ENV !== "production" ? "secret" : null);
        if (!sessionCookieSecret)
            throw new InternalError(
                "Environment variable `SESSION_COOKIE_SECRET` must be set in production",
            );

        const sessionCookieStorage = new SessionCookieStorage({
            // The session cookie domain is not set in development because we may be
            // accessing from a proxied domain or an IP address on a mobile device.
            domain: process.env.NODE_ENV === "production" ? "cyberworlds.dev" : null,
            secret: sessionCookieSecret,
        });

        const awsClient = createAwsClientFromEnv(env);
        const awsContextModule = new AwsContextModule(awsClient);

        sharedResources = {
            env,
            sessionCookieSecret,
            sessionCookieStorage,
            awsContextModule,
        };
    }
    const resources = sharedResources;

    // In development we have middleware on our HTTP server that serves static
    // files from the file system instead of a Cloudflare KV namespace.
    if (process.env.NODE_ENV === "production") {
        // Backwards compatibility with Cloudflare service worker syntax. (Instead of
        // Cloudflare module syntax.)
        // https://developers.cloudflare.com/workers/runtime-apis/fetch-event
        const event: FetchEvent & {[contextSymbol]?: LoadContext} = Object.assign(
            new Event("fetch"),
            {
                request,
                waitUntil: (promise: Promise<any>) => executionContext.waitUntil(promise),
                passThroughOnException: () => executionContext.passThroughOnException(),
                respondWith: () => {
                    throw new InternalError("Can not respond through fetch event stub");
                },
            },
        );

        const response = await handleAsset(event, build, {
            ASSET_NAMESPACE: env.__STATIC_CONTENT,
            ASSET_MANIFEST: await staticContentManifestPromise,
        });
        if (response) return response;
    }

    // Don't trace asset requests. If we do one day trace asset requests we should
    // do it with a low sample rate.
    return traceFetchResponse(tracer, request, async (tracerSpan, request, url) => {
        // Backwards compatibility with Cloudflare service worker syntax. (Instead of
        // Cloudflare module syntax.)
        // https://developers.cloudflare.com/workers/runtime-apis/fetch-event
        const event: FetchEvent & {[contextSymbol]?: LoadContext} = Object.assign(
            new Event("fetch"),
            {
                request,
                waitUntil: (promise: Promise<any>) => executionContext.waitUntil(promise),
                passThroughOnException: () => executionContext.passThroughOnException(),
                respondWith: () => {
                    throw new InternalError("Can not respond through fetch event stub");
                },
            },
        );

        if (url.pathname.startsWith("/durable-objects/")) {
            const path = url.pathname.slice("/durable-objects/".length).split("/");
            switch (path[0]) {
                case "documents": {
                    const documentId = Schema.id.deserialize(path[1] ?? null);

                    const durableObjectId =
                        env.DocumentCollaborationDurableObjectNamespace.idFromName(documentId);
                    const durableObjectStub =
                        env.DocumentCollaborationDurableObjectNamespace.get(durableObjectId);

                    const newUrl = new URL(url);
                    newUrl.pathname = `/${path.slice(2).join("/")}`;
                    const newRequest = new Request(newUrl.toString(), event.request);
                    newRequest.headers.set("x-document-id", documentId);

                    const sessionCookie = await resources.sessionCookieStorage.get(request);
                    if (!sessionCookie.sessionId) throw unauthenticatedSessionError();

                    // Create a short-lived JWT for sharing the `sessionId` with the durable object.
                    //
                    // We use a JWT to ensure that it's our app worker sending the `sessionId`. If
                    // an attacker got access to the Durable Object URL then they could send a
                    // request with whatever `sessionId` they have access to! Using a signed JWT
                    // prevents that.
                    const authenticationToken = await new SignJWT({
                        sessionId: sessionCookie.sessionId,
                    })
                        .setProtectedHeader({alg: "HS256"})
                        .setIssuedAt()
                        .setExpirationTime("2m")
                        .sign(new TextEncoder().encode(resources.sessionCookieSecret));

                    newRequest.headers.set("authorization", `bearer ${authenticationToken}`);

                    return durableObjectStub.fetch(newRequest);
                }
                default:
                    return new Response("Durable object not found", {status: 404});
            }
        }

        return resources.sessionCookieStorage.with(request, sessionCookiePromise => {
            return Context.with<LoadContextModules, Response>(
                {
                    process: new ProcessContextModule({
                        waitUntil: promise => executionContext.waitUntil(promise),
                    }),
                    tracer: new TracerContextModule(tracerSpan),
                    aws: resources.awsContextModule,
                    rpc: new LocalRpcContextModule(),
                    sessionCookie: new SessionCookieContextModule(sessionCookiePromise),

                    auth: new UnauthenticatedAuthContextModule(async context => {
                        const sessionCookie = await sessionCookiePromise;

                        const {sessionId} = sessionCookie.get();
                        if (!sessionId) return null;

                        const session = await Session.get(context, sessionId);
                        if (!session) {
                            // If the session was deleted since we stored the session in our cookie, remove
                            // the session from the cookie.
                            sessionCookie.unsetSessionId();
                            return null;
                        }

                        return session;
                    }),
                },
                async context => {
                    event[contextSymbol] = context;
                    const response = await handleRequest(event);
                    return response;
                },
            );
        });
    });
}

export default {fetch};

// Export the durable object so Cloudflare can pick it up. in the future, we
// should maybe use separate bundles for each durable object.
export {DocumentCollaborationDurableObject} from "~/server/documents/document_collaboration_durable_object";
