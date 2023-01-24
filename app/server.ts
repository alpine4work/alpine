import {AppLoadContext} from "@remix-run/cloudflare";
import {createRequestHandler, handleAsset} from "@remix-run/cloudflare-workers";
import * as build from "@remix-run/dev/server-build";
import {parse as parseCookieHeader} from "cookie";
import {SignJWT} from "jose";
import {defaultClientInfo} from "~/client/remix/client_info_context";
import {createAwsContextModulesFromEnv} from "~/server/aws/create_aws_context_modules_from_env";
import {Session} from "~/server/dynamo/accounts_table";
import {UnauthenticatedAuthContextModule} from "~/server/dynamo/context/auth_context_module";
import {unauthenticatedSessionError} from "~/server/dynamo/context/helpers/unauthenticated_session_error";
import {DynamoContextModule} from "~/server/dynamo/dynamo_context_module";
import {seedDynamo} from "~/server/dynamo/seed_dynamo";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base";
import {
    LoaderContext,
    LoaderContextModule,
    LoaderContextModules,
} from "~/server/remix/loader_context";
import {SessionCookieStorage} from "~/server/remix/session_cookie";
import {LocalRpcContextModule} from "~/server/rpc/local_rpc_context_module";
import {createServerTracer} from "~/server/tracer/server_tracer";
import {traceFetchResponse} from "~/server/tracer/trace_fetch_response";
import {CacheContextModule} from "~/shared/context/cache_context_module";
import {Context} from "~/shared/context/context";
import {ProcessContextModule} from "~/shared/context/process_context_module";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {InternalError} from "~/shared/error/error";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {DocumentId} from "~/shared/id/types/id_types";
import {ClientInfoSchema} from "~/shared/remix/client_info";
import {Schema} from "~/shared/schema/schema";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header";

type AppWorkerEnv = {
    DocumentCollaborationDurableObjectNamespace: DurableObjectNamespace;
    DEV_SERVER_PORT?: string;
    DYNAMO_LOCAL_PORT?: string;
    SESSION_COOKIE_SECRET?: string;
    AWS_SECRET_ACCESS_KEY?: string;
    AWS_ACCESS_KEY_ID?: string;
    HONEYCOMB_API_KEY?: string;
    __STATIC_CONTENT?: string;
};

const contextSymbol = Symbol("context");

const handleRequest = createRequestHandler({
    build,
    getLoadContext(event: FetchEvent & {[contextSymbol]?: LoaderContext}) {
        const context = assertExists(event[contextSymbol]);
        return context as any as AppLoadContext;
    },
});

// Cache some shared resources across requests.
let sharedResources: {
    env: AppWorkerEnv;
    sessionCookieSecret: string;
    sessionCookieStorage: SessionCookieStorage;
    awsContextModules: {
        dynamo: DynamoContextModule;
        email: EmailContextModuleBase;
    };
} | null = null;

function getSharedResources(env: AppWorkerEnv) {
    // An env object that is referentially equal will be passed in as long as
    // environment variables remain the same.
    // https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#parameters
    if (sharedResources === null || sharedResources.env !== env) {
        const sessionCookieSecret = env.SESSION_COOKIE_SECRET;
        if (!sessionCookieSecret)
            throw new InternalError("Missing `SESSION_COOKIE_SECRET` environment variable");

        const sessionCookieStorage = new SessionCookieStorage({
            // The session cookie domain is not set in development because we may be
            // accessing from a proxied domain or an IP address on a mobile device.
            domain: process.env.NODE_ENV === "production" ? "cyberworlds.dev" : null,
            secret: sessionCookieSecret,
        });

        sharedResources = {
            env,
            sessionCookieSecret,
            sessionCookieStorage,
            awsContextModules: createAwsContextModulesFromEnv(env),
        };
    }
    return sharedResources;
}

// See: https://github.com/cloudflare/wrangler/pull/2126
const staticContentManifestPromise =
    process.env.NODE_ENV === "production"
        ? import("__STATIC_CONTENT_MANIFEST").then(manifestJson => JSON.parse(manifestJson.default))
        : null;

let hasSeededDynamo = false;

async function handleFetch(
    request: Request,
    env: AppWorkerEnv,
    executionContext: ExecutionContext,
): Promise<Response> {
    const url = new URL(request.url);

    // We implement the time API route directly in our Cloudflare Worker body and
    // put it before all other work.
    //
    // We use this route to implement [clock synchronization with NTP][1].
    //
    // Normally, NTP needs the time of both server packet reception and server
    // packet transmission to work. But Cloudflare only updates the clock during IO
    // (not synchronous CPU work, see [security model][2]) so we only have the time
    // at which our worker received the request. That's fine, that time can be both
    // the server start time and server end time and we pretend like the server
    // response was less than 1ms.
    //
    // So we want to respond to this route the absolute fastest Cloudflare Workers
    // can allow so that the route time is as close to under 1ms as possible. Which
    // is why we put this route handler first before all other processing.
    //
    // [1]: https://en.wikipedia.org/wiki/Network_Time_Protocol
    // [2]: https://developers.cloudflare.com/workers/learning/security-model/
    if (url.pathname === "/api/time") {
        return new Response(JSON.stringify({time: Date.now()}), {
            status: 200,
            headers: {"content-type": "application/json"},
        });
    }

    const resources = getSharedResources(env);

    // In development we have middleware on our HTTP server that serves static
    // files from the file system instead of a Cloudflare KV namespace.
    if (process.env.NODE_ENV === "production") {
        // Backwards compatibility with Cloudflare service worker syntax. (Instead of
        // Cloudflare module syntax.)
        // https://developers.cloudflare.com/workers/runtime-apis/fetch-event
        const event: FetchEvent & {[contextSymbol]?: LoaderContext} = Object.assign(
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

    // Create a new tracer for every request because we need a Honeycomb client and
    // the Honeycomb client needs `executionContext.waitUntil()` which is request
    // scoped. Tracers are cheap to construct so this is fine.
    const tracer = createServerTracer({
        serviceName: "AppServer",
        env,
        waitUntil: promise => executionContext.waitUntil(promise),
    });

    // Don't trace asset requests. If we do one day trace asset requests we should
    // do it with a low sample rate.
    return traceFetchResponse(tracer, request, url, async (span, request) => {
        // Backwards compatibility with Cloudflare service worker syntax. (Instead of
        // Cloudflare module syntax.)
        // https://developers.cloudflare.com/workers/runtime-apis/fetch-event
        const event: FetchEvent & {[contextSymbol]?: LoaderContext} = Object.assign(
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
                    const documentId = Schema.id<DocumentId>().deserialize(path[1] ?? null);

                    const durableObjectId =
                        env.DocumentCollaborationDurableObjectNamespace.idFromName(documentId);
                    const durableObjectStub =
                        env.DocumentCollaborationDurableObjectNamespace.get(durableObjectId);

                    const newUrl = new URL(url);
                    newUrl.pathname = `/${path.slice(2).join("/")}`;
                    const newRequest = new Request(newUrl.toString(), event.request);
                    newRequest.headers.set("cyberworlds-document-id", documentId);
                    addTracerPropagationContextHeader(newRequest.headers, span);

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
            const cookieHeader = request.headers.get("cookie");
            const clientInfoCookieString = cookieHeader
                ? parseCookieHeader(cookieHeader)["client-info"]
                : null;

            let clientInfo = defaultClientInfo;
            if (clientInfoCookieString) {
                try {
                    clientInfo = ClientInfoSchema.deserialize(JSON.parse(clientInfoCookieString));
                } catch {
                    // Ignore any errors when parsing the client info cookie.
                    // TODO(calebmer): We should report it in an event though?
                }
            }

            return Context.with<LoaderContextModules, Response>(
                {
                    ...resources.awsContextModules,
                    process: new ProcessContextModule({
                        waitUntil: promise => executionContext.waitUntil(promise),
                    }),
                    tracer: new TracerContextModule(span),
                    rpc: new LocalRpcContextModule(),
                    loader: new LoaderContextModule({
                        sessionCookiePromise,
                        clientInfo,
                        devServerPort: env.DEV_SERVER_PORT
                            ? parseInt(env.DEV_SERVER_PORT, 10)
                            : null,
                    }),
                    cache: new CacheContextModule(),

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
                    // The first time our server process runs in development, seed DynamoDB with
                    // some initial data. The seed function should be idempotent.
                    if (process.env.NODE_ENV !== "production" && !hasSeededDynamo) {
                        hasSeededDynamo = true;
                        context.process.waitUntil(seedDynamo(context));
                    }

                    event[contextSymbol] = context;
                    const response = await handleRequest(event);
                    return response;
                },
            );
        });
    });
}

export default {fetch: handleFetch};

// Export the durable object so Cloudflare can pick it up. in the future, we
// should maybe use separate bundles for each durable object.
export {DocumentCollaborationDurableObject} from "~/server/documents/document_collaboration_durable_object";
