import {parse as parseCookieHeader} from "cookie";
import {appStaticManifestPaths} from "~/app/static/app_static_manifest_paths.js";
import {
    WorkerRpcContextBatcher,
    WorkerRpcContextModule,
} from "~/server/cloudflare/context/worker_rpc_context_module.js";
import {fetchFromDurableObjectStub} from "~/server/cloudflare/fetch_from_durable_object_stub.js";
import {EdgeServiceEnv} from "~/server/edge/edge_service_env.js";
import {fetchFile} from "~/server/edge/fetch_file.js";
import {
    completeFileMultipartUpload,
    createFileMultipartUpload,
    putFileMultipartUploadPart,
} from "~/server/edge/file_multipart_upload.js";
import {TaskRealtimeServiceEdgeRouter} from "~/server/edge/task_realtime_service_edge_router.js";
import {uploadAvatar} from "~/server/edge/upload_avatar.js";
import {uploadFile} from "~/server/edge/upload_file.js";
import {SessionActorContextModule} from "~/server/helpers/actor_context_module.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {getSessionCookieIfExists} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentPrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {TokenAgentPublicSide} from "~/server/tokens/token_agent_public_side.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {
    createTraceServerResponseHandleSpanName,
    getRequestIpAddress,
    traceServerResponse,
} from "~/server/tracer/trace_server_response.js";
import {AuthSignInOrSignUpOutputSchema} from "~/shared/auth/auth_sign_in_or_sign_up_schema.js";
import {
    AvatarEntityPath,
    isAvatarEntityPath,
    printAvatarEntityObjectIntoTracerRoute,
} from "~/shared/avatar/avatar_entity_path.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DeadlineExceededError, InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {isTransientError} from "~/shared/error/is_transient_error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {CookieJar} from "~/shared/helpers/http/cookie_jar.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    RpcHttpBatchCallErrorOutputSchema,
    RpcHttpCallOutputSchema,
} from "~/shared/rpc/helpers/rpc_http_schema.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// Cache some shared resources across requests.
let sharedResources: EdgeServiceSharedResources | null = null;

type EdgeServiceSharedResources = {
    env: EdgeServiceEnv;
    tokenAgentPromise: Promise<TokenAgent>;
    taskRealtimeServiceRouterPromise: Promise<TaskRealtimeServiceEdgeRouter>;
};

type EdgeServiceRoute =
    | "AppService"
    | {type: "IpAddress"}
    | {type: "DocumentCollaborationService"; documentId: string; pathname: string}
    | {type: "PostRealtimeService"; postId: string; pathname: string}
    | {type: "ChannelRealtimeService"; channelId: string; pathname: string}
    | {type: "ChatRealtimeService"; chatId: string; pathname: string}
    | {type: "MyAccountService"; accountId: string; pathname: string}
    | {type: "TaskNotesCollaborationService"; taskId: string; pathname: string}
    | {type: "TaskRealtimeService"; spaceId: SpaceId}
    | {type: "LoadTaskQueries"; spaceId: SpaceId}
    | {type: "UploadFile"; spaceId: SpaceId}
    | {type: "CreateFileMultipartUpload"; spaceId: SpaceId}
    | {type: "PutFileMultipartUploadPart"; spaceId: SpaceId; fileId: FileId; partNumber: string}
    | {type: "CompleteFileMultipartUpload"; spaceId: SpaceId; fileId: FileId}
    | {type: "File"; spaceId: SpaceId; fileId: FileId}
    | {type: "FileCorsProxy"; url: string}
    | {type: "UploadAvatar"; avatarEntityPath: AvatarEntityPath}
    | {type: "MeetCaleb"};

async function handleFetch(
    request: Request,
    env: EdgeServiceEnv,
    executionContext: ExecutionContext,
) {
    const startTime = Date.now();

    const url = new URL(request.url);

    // Hitting the home page (`/`) will redirect you to the landing page if you're
    // signed out. If you want to see the home page while signed in you can
    // navigate to https://www.alpine.inc directly.
    if (url.pathname === "/") {
        const cookieHeader = request.headers.get("cookie");

        if (!(cookieHeader && hasOwnProperty(parseCookieHeader(cookieHeader), "session"))) {
            return new Response(null, {
                status: 302,
                headers: {location: "https://www.alpine.inc"},
            });
        }
    }

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
    // Used by `synchronized_system_clock.ts`.
    //
    // [1]: https://en.wikipedia.org/wiki/Network_Time_Protocol
    // [2]: https://developers.cloudflare.com/workers/learning/security-model/
    if (url.pathname === "/api/time") {
        // eslint-disable-next-line cyberworlds/string-quotes
        return new Response(`{"startTime":${startTime},"endTime":${Date.now()}}`, {
            status: 200,
            headers: {"content-type": "application/json"},
        });
    }

    // TODO(rmtobin, 2025-10-20, #files-edge-service): Remove this case once we've
    // moved file serving to the files edge service Fast path for static asset
    // requests. We don't want to trace these requests or perform any other
    // request/response manipulation.
    if (
        appStaticManifestPaths.has(url.pathname) ||
        url.pathname.startsWith("/assets/") ||
        // NOTE(calebmer, 2024-08-20): Exists for backwards compatibility before we
        // used Vite for compilation. Can remove once clients that expect static assets
        // under `/build` no longer exist.
        url.pathname.startsWith("/build/")
    ) {
        // In development, static assets are served by `serve-static` middleware in
        // `AppService`. In production we serve static assets from Cloudflare R2.
        if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line cyberworlds/no-global-fetch
            return fetch(request);
        }

        const cache: Cache =
            // @ts-expect-error: `@cloudflare/workers-types` doesn't seem to be providing
            // the correct types for us.
            caches.default;

        // We follow R2's "[Use the Cache API][1]" example for caching R2 objects in
        // Cloudflare's global cache.
        //
        // [1]: https://developers.cloudflare.com/r2/examples/cache-api/
        const cachedResponse = await cache.match(request);
        if (cachedResponse) return cachedResponse;

        const object = await env.AppStaticBucket.get(`files${url.pathname}`);
        if (object === null) {
            return new Response("404 Not Found", {
                status: 404,
                headers: {"content-type": "text/plain"},
            });
        }

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);

        // Remix fingerprints its assets so we can cache them forever. Other assets
        // (like `favicon.ico`) are cached for a day then can be updated.
        //
        // We manually version our font assets so fonts can be cached forever too. If
        // we need to update a font the file name will change.
        if (
            url.pathname.startsWith("/fonts/") ||
            url.pathname.startsWith("/assets/") ||
            // NOTE(calebmer, 2024-08-20): Exists for backwards compatibility before we
            // used Vite for compilation. Can remove once clients that expect static assets
            // under `/build` no longer exist.
            url.pathname.startsWith("/build/")
        ) {
            // - `public`: Means we can store the asset in a shared cache since they don't
            //   depend on authorization.
            // - `max-age=31536000`: The asset lives for one year.
            // - `immutable`: Indicates the response will never update.
            headers.set("cache-control", "public, max-age=31536000, immutable");
        } else {
            // - `public`: Means we can store the asset in a shared cache since they don't
            //   depend on authorization.
            // - `max-age=86400`: The asset lives for one day.
            // - `stale-while-revalidate=31536000`: When the asset is stale, the cache is
            //   allowed to continue using it for a year as long as the cache revalidates
            //   the asset in the background.
            headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=31536000");
        }

        const response = new Response(object.body, {headers});

        // Put the R2 object in Cloudflare's cache to speed up future requests.
        executionContext.waitUntil(cache.put(request, response.clone()));

        return response;
    }

    // Optimization: In development, any requests that load a resource from Vite
    // should go directly to `AppService` and skip tracing. Without this, a
    // significant number of Honeycomb events come from Vite requests in
    // development environments.
    if (process.env.NODE_ENV === "development" && url.pathname.startsWith("/vite/")) {
        // eslint-disable-next-line cyberworlds/no-global-fetch
        return fetch(request);
    }

    // Create a new tracer for every request because we need a Honeycomb client and
    // the Honeycomb client needs `executionContext.waitUntil()` which is request
    // scoped. Tracers are cheap to construct so this is fine.
    const tracer = createServerTracer({
        serviceName: "EdgeService",
        jsHost: "CloudflareWorker",
        honeycombApiKey: env.HONEYCOMB_API_KEY,
        honeycombDataset: "tracer",
        waitUntil: promise => executionContext.waitUntil(promise),
    });

    let routeString = "/*";
    let route: EdgeServiceRoute = "AppService";

    if (url.pathname.startsWith("/files/")) {
        const pathSegments = url.pathname.slice(7).split("/");

        if (pathSegments.length === 2 && pathSegments[0] === "cors-proxy") {
            const url = decodeURIComponent(pathSegments[1]!);
            routeString = "/files/cors-proxy/:url";
            route = {type: "FileCorsProxy", url};
        } else if (
            pathSegments.length === 2 &&
            isId<SpaceId>(pathSegments[0]!) &&
            isId<FileId>(pathSegments[1]!)
        ) {
            routeString = "/files/:spaceId/:fileId";
            route = {type: "File", spaceId: pathSegments[0], fileId: pathSegments[1]};
        }
    } else if (url.pathname === "/meet-caleb") {
        // NOTE(calebmer, 2026-01-14): Temporary route we can send people to book a
        // meeting on my calendar. Eventually we'll probably want to delete this.
        routeString = "/meet-caleb";
        route = {type: "MeetCaleb"};
    } else if (!url.pathname.startsWith("/api/")) {
        // Route to `AppService`...
    } else if (url.pathname === "/api/ip-address") {
        routeString = "/api/ip-address";
        route = {type: "IpAddress"};
    } else if (url.pathname.startsWith("/api/durable-objects/")) {
        const pathSegments = url.pathname.slice(21).split("/");

        switch (pathSegments[0]) {
            case "documents": {
                const documentId = pathSegments[1];
                if (documentId === undefined) break;

                const pathname = `/${pathSegments.slice(2).join("/")}`;

                routeString = `/api/durable-objects/documents/:documentId${
                    pathname === "/view" ? pathname : pathname !== "/" ? "/*" : ""
                }`;
                route = {type: "DocumentCollaborationService", documentId, pathname};
                break;
            }
            case "posts": {
                const postId = pathSegments[1];
                if (postId === undefined) break;

                const pathname = `/${pathSegments.slice(2).join("/")}`;

                routeString = `/api/durable-objects/posts/:postId${pathname !== "/" ? "/*" : ""}`;
                route = {type: "PostRealtimeService", postId, pathname};
                break;
            }
            case "channels": {
                const channelId = pathSegments[1];
                if (channelId === undefined) break;

                const pathname = `/${pathSegments.slice(2).join("/")}`;

                routeString = `/api/durable-objects/channels/:channelId${
                    pathname !== "/" ? "/*" : ""
                }`;
                route = {type: "ChannelRealtimeService", channelId, pathname};
                break;
            }
            case "chat": {
                const chatId = pathSegments[1];
                if (chatId === undefined) break;

                const pathname = `/${pathSegments.slice(2).join("/")}`;

                routeString = `/api/durable-objects/chat/:chatId${pathname !== "/" ? "/*" : ""}`;
                route = {type: "ChatRealtimeService", chatId, pathname};
                break;
            }
            case "my-account": {
                const accountId = pathSegments[1];
                if (accountId === undefined) break;

                const pathname = `/${pathSegments.slice(2).join("/")}`;

                routeString = `/api/durable-objects/my-account/:accountId${
                    pathname !== "/" ? "/*" : ""
                }`;
                route = {type: "MyAccountService", accountId, pathname};
                break;
            }
            case "task-notes": {
                const taskId = pathSegments[1];
                if (taskId === undefined) break;

                const pathname = `/${pathSegments.slice(2).join("/")}`;

                routeString = `/api/durable-objects/task-notes/:taskId${
                    pathname !== "/" ? "/*" : ""
                }`;
                route = {type: "TaskNotesCollaborationService", taskId, pathname};
                break;
            }
            default: {
                break;
            }
        }
    } else if (url.pathname.startsWith("/api/task-realtime/")) {
        const pathSegments = url.pathname.slice("/api/task-realtime/".length).split("/");
        if (pathSegments.length === 1) {
            const spaceId = pathSegments[0]!;
            if (isId<SpaceId>(spaceId)) {
                routeString = "/api/task-realtime/:spaceId";
                route = {type: "TaskRealtimeService", spaceId};
            }
        }

        if (pathSegments.length === 2 && pathSegments[1] === "loadQueries") {
            const spaceId = pathSegments[0]!;
            if (isId<SpaceId>(spaceId)) {
                routeString = "/api/task-realtime/:spaceId/loadQueries";
                route = {type: "LoadTaskQueries", spaceId};
            }
        }
    } else if (url.pathname.startsWith("/api/files/")) {
        const pathSegments = url.pathname.slice("/api/files/".length).split("/");
        if (isId<SpaceId>(pathSegments[0]!)) {
            if (pathSegments.length === 2 && pathSegments[1] === "upload") {
                routeString = "/api/files/:spaceId/upload";
                route = {type: "UploadFile", spaceId: pathSegments[0]};
            } else if (pathSegments[1] === "multipart-upload") {
                if (pathSegments.length === 2) {
                    routeString = "/api/files/:spaceId/multipart-upload";
                    route = {type: "CreateFileMultipartUpload", spaceId: pathSegments[0]};
                } else if (pathSegments.length > 2 && isId<FileId>(pathSegments[2]!)) {
                    if (pathSegments.length === 4 && pathSegments[3] === "complete") {
                        routeString = "/api/files/:spaceId/multipart-upload/:fileId/complete";
                        route = {
                            type: "CompleteFileMultipartUpload",
                            spaceId: pathSegments[0],
                            fileId: pathSegments[2],
                        };
                    } else if (pathSegments.length === 5 && pathSegments[3] === "part") {
                        routeString =
                            "/api/files/:spaceId/multipart-upload/:fileId/part/:partNumber";
                        route = {
                            type: "PutFileMultipartUploadPart",
                            spaceId: pathSegments[0],
                            fileId: pathSegments[2],
                            partNumber: pathSegments[4]!,
                        };
                    }
                }
            }
        }
    } else if (url.pathname.startsWith("/api/avatar/")) {
        const path = url.pathname.slice("/api/avatar/".length);
        if (isAvatarEntityPath(path)) {
            routeString = `/api/avatar/${printAvatarEntityObjectIntoTracerRoute(path)}`;
            route = {type: "UploadAvatar", avatarEntityPath: path};
        }
    }

    return traceServerResponse(tracer, request, url, routeString, async (span, request) => {
        try {
            // Important to `await` here so that our try/catch catches any errors
            // asynchronously thrown by this function.
            const initialResponse = await actuallyHandleFetch(
                request,
                env,
                executionContext,
                startTime,
                url,
                route,
                span,
            );

            const responseHeaders = new Headers(initialResponse.headers);

            // Only allow our pages to be embedded on our own origin.
            responseHeaders.set("x-frame-options", "sameorigin");

            if (process.env.NODE_ENV === "production") {
                // Tell browsers to enforce HTTPS for all requests.
                responseHeaders.set("strict-transport-security", "max-age=3600; includeSubDomains");
            }

            // If the initial response is a WebSocket, return a new response with the WebSocket and a null body.
            const response = initialResponse.webSocket
                ? new Response(null, {
                      status: initialResponse.status,
                      statusText: initialResponse.statusText,
                      headers: responseHeaders,
                      webSocket: initialResponse.webSocket,
                  })
                : new Response(initialResponse.body, {
                      status: initialResponse.status,
                      statusText: initialResponse.statusText,
                      headers: responseHeaders,
                  });

            return response;
        } catch (error) {
            span.addException(error);
            return createSimpleErrorResponse(error);
        }
    });
}

async function actuallyHandleFetch(
    request: Request,
    env: EdgeServiceEnv,
    executionContext: ExecutionContext,
    startTime: number,
    url: URL,
    route: EdgeServiceRoute,
    span: TracerSpan,
) {
    if (typeof route !== "string") {
        // An env object that is referentially equal will be passed in as long as
        // environment variables remain the same.
        // https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#parameters
        if (sharedResources === null || sharedResources.env !== env) {
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

            const apiServicePublicKey = env.API_SERVICE_PUBLIC_KEY;
            if (!apiServicePublicKey)
                throw new InternalError("Missing `API_SERVICE_PUBLIC_KEY` env variable");

            const resourceServicePublicKey = env.RESOURCE_SERVICE_PUBLIC_KEY;
            if (!resourceServicePublicKey)
                throw new InternalError("Missing `RESOURCE_SERVICE_PUBLIC_KEY` env variable");

            const edgeServiceFamilyPrivateKey = env.EDGE_SERVICE_FAMILY_PRIVATE_KEY;
            if (!edgeServiceFamilyPrivateKey)
                throw new InternalError("Missing `EDGE_SERVICE_FAMILY_PRIVATE_KEY` env variable");

            const tokenAgentSecret = env.TOKEN_AGENT_SECRET;
            if (!tokenAgentSecret)
                throw new InternalError("Missing `TOKEN_AGENT_SECRET` env variable");

            const tokenAgentPromise = runAllPromises([
                TokenAgentPublicSide.new({
                    serviceName: "EdgeService",
                    appServicePublicKey,
                    edgeServiceFamilyPublicKey,
                    taskRealtimeServicePublicKey,
                    jobQueueServicePublicKey,
                    fileProcessorServicePublicKey,
                    apiServicePublicKey,
                    resourceServicePublicKey,
                    secret: tokenAgentSecret,
                }),
                TokenAgentPrivateSide.new({
                    serviceName: "EdgeService",
                    servicePrivateKey: edgeServiceFamilyPrivateKey,
                    secret: tokenAgentSecret,
                }),
            ]).then(([publicSide, privateSide]) => ({publicSide, privateSide}));

            const ourSharedResources: typeof sharedResources = {
                env,
                tokenAgentPromise,
                taskRealtimeServiceRouterPromise: tokenAgentPromise.then(
                    tokenAgent =>
                        new TaskRealtimeServiceEdgeRouter({
                            protocol: url.protocol,
                            host: url.host,
                            tokenAgent,
                        }),
                ),
            };

            sharedResources = ourSharedResources;
        }

        const tokenAgent = await sharedResources.tokenAgentPromise;

        switch (route.type) {
            case "IpAddress": {
                if (request.method !== "GET") {
                    throw new InvalidArgumentError(quote`Invalid request method ${request.method}`);
                }

                // Return the client's IP address as seen by Cloudflare. Used during sign in
                // and sign up to record the IP address of the current session in our database.
                return new Response(getRequestIpAddress(request), {
                    status: 200,
                    headers: {"content-type": "plain/text"},
                });
            }

            case "DocumentCollaborationService": {
                return fetchFromDurableObjectStub({
                    durableObjectNamespace: env.DocumentCollaborationDurableObjectNamespace,
                    serviceName: "DocumentCollaborationService",
                    tokenAgent,
                    cookieNameSuffix: env.COOKIE_NAME_SUFFIX,
                    request,
                    pathname: route.pathname,
                    idName: route.documentId,
                    span,
                });
            }

            case "PostRealtimeService": {
                return fetchFromDurableObjectStub({
                    durableObjectNamespace: env.PostRealtimeDurableObjectNamespace,
                    serviceName: "PostRealtimeService",
                    tokenAgent,
                    cookieNameSuffix: env.COOKIE_NAME_SUFFIX,
                    request,
                    pathname: route.pathname,
                    idName: route.postId,
                    span,
                });
            }

            case "ChannelRealtimeService": {
                return fetchFromDurableObjectStub({
                    durableObjectNamespace: env.ChannelRealtimeDurableObjectNamespace,
                    serviceName: "ChannelRealtimeService",
                    tokenAgent,
                    cookieNameSuffix: env.COOKIE_NAME_SUFFIX,
                    request,
                    pathname: route.pathname,
                    idName: route.channelId,
                    span,
                });
            }

            case "ChatRealtimeService": {
                return fetchFromDurableObjectStub({
                    durableObjectNamespace: env.ChatRealtimeDurableObjectNamespace,
                    serviceName: "ChatRealtimeService",
                    tokenAgent,
                    cookieNameSuffix: env.COOKIE_NAME_SUFFIX,
                    request,
                    pathname: route.pathname,
                    idName: route.chatId,
                    span,
                });
            }

            case "MyAccountService": {
                return fetchFromDurableObjectStub({
                    durableObjectNamespace: env.MyAccountDurableObjectNamespace,
                    serviceName: "MyAccountService",
                    tokenAgent,
                    cookieNameSuffix: env.COOKIE_NAME_SUFFIX,
                    request,
                    pathname: route.pathname,
                    idName: route.accountId,
                    span,
                });
            }

            case "TaskNotesCollaborationService": {
                return fetchFromDurableObjectStub({
                    durableObjectNamespace: env.TaskNotesCollaborationDurableObjectNamespace,
                    serviceName: "TaskNotesCollaborationService",
                    tokenAgent,
                    cookieNameSuffix: env.COOKIE_NAME_SUFFIX,
                    request,
                    pathname: route.pathname,
                    idName: route.taskId,
                    span,
                });
            }

            case "TaskRealtimeService": {
                const {spaceId} = route;
                const taskRealtimeServiceRouter =
                    await sharedResources.taskRealtimeServiceRouterPromise;

                const headers = new Headers(request.headers);
                addTracerPropagationContextHeader(headers, span);

                // We authenticate with an `Authorization` not a `Cookie` header.
                headers.delete("cookie");

                // When connecting to `TaskRealtimeService` via the edge, you must authenticate
                // with a session cookie. `Authorization` headers are ignored.
                const sessionCookieToken = await getSessionCookieIfExists({
                    tokenAgent,
                    cookieNameSuffix: env.COOKIE_NAME_SUFFIX,
                    request,
                });
                if (!sessionCookieToken) throw unauthenticatedSessionError();

                const requestToken = await tokenAgent.privateSide.dangerouslySignShortLivedToken(
                    "TaskRealtimeService",
                    sessionCookieToken,
                );
                headers.set("authorization", `bearer ${requestToken}`);

                const taskRealtimeServiceHost =
                    await taskRealtimeServiceRouter.getStickyAccountHost(
                        Context.new({
                            process: new ProcessContextModule({
                                waitUntil: promise => executionContext.waitUntil(promise),
                            }),
                            tracer: new TracerContextModule(span),
                        }),
                        spaceId,
                        sessionCookieToken.accountId,
                    );

                if (process.env.NODE_ENV !== "production") {
                    // eslint-disable-next-line cyberworlds/no-global-fetch
                    return fetch(`http://${taskRealtimeServiceHost}/${spaceId}`, {headers});
                }

                const [taskRealtimeServiceHostname = "", taskRealtimeServicePort = ""] =
                    taskRealtimeServiceHost.split(":");

                // Proxy a WebSocket connection through Cloudflare. Notice we're using `http`
                // instead of `https`! Cloudflare is responsible for encrypting.
                //
                // Frustratingly, in production Cloudflare ignores non-default ports. So we run
                // a small proxy server in `TaskRealtimeService` on port 80 that redirects to
                // the right port.
                //
                // eslint-disable-next-line cyberworlds/no-global-fetch
                return fetch(
                    `http://${taskRealtimeServiceHostname}:80/${taskRealtimeServicePort}/${spaceId}`,
                    {headers},
                );
            }

            case "LoadTaskQueries": {
                // Can't forward a request to upgrade to a WebSocket connection to
                // this endpoint of `TaskRealtimeService`.
                if (request.headers.has("upgrade"))
                    throw new InvalidArgumentError("Can\u2019t upgrade to WebSocket connection");

                if (request.method !== "POST") {
                    throw new InvalidArgumentError(quote`Invalid request method ${request.method}`);
                }

                const {spaceId} = route;
                const taskRealtimeServiceRouter =
                    await sharedResources.taskRealtimeServiceRouterPromise;

                const headers = new Headers(request.headers);
                addTracerPropagationContextHeader(headers, span);

                // We authenticate with an `Authorization` not a `Cookie` header.
                headers.delete("cookie");

                // When connecting to `TaskRealtimeService` via the edge, you must authenticate
                // with a session cookie. `Authorization` headers are ignored.
                const sessionCookieToken = await getSessionCookieIfExists({
                    tokenAgent,
                    cookieNameSuffix: env.COOKIE_NAME_SUFFIX,
                    request,
                });

                const requestToken = await tokenAgent.privateSide.dangerouslySignShortLivedToken(
                    "TaskRealtimeService",
                    sessionCookieToken ?? {type: "Anonymous"},
                );
                headers.set("authorization", `bearer ${requestToken}`);

                const routerContext = Context.new({
                    process: new ProcessContextModule({
                        waitUntil: promise => executionContext.waitUntil(promise),
                    }),
                    tracer: new TracerContextModule(span),
                });

                const taskRealtimeServiceHost = sessionCookieToken
                    ? await taskRealtimeServiceRouter.getStickyAccountHost(
                          routerContext,
                          spaceId,
                          sessionCookieToken.accountId,
                      )
                    : // TODO(calebmer): Probably better to send anonymous actors to a sticky host as
                      // well based on `BrowserId`. Maybe we should always use `BrowserId` actually
                      // to simplify code.
                      await taskRealtimeServiceRouter.getRandomHost(routerContext, spaceId);

                if (process.env.NODE_ENV !== "production") {
                    // eslint-disable-next-line cyberworlds/no-global-fetch
                    return fetch(`http://${taskRealtimeServiceHost}/${spaceId}/loadQueries`, {
                        method: "POST",
                        headers,
                        body: request.body,
                    });
                }

                const [taskRealtimeServiceHostname = "", taskRealtimeServicePort = ""] =
                    taskRealtimeServiceHost.split(":");

                // Proxy a WebSocket connection through Cloudflare. Notice we're using `http`
                // instead of `https`! Cloudflare is responsible for encrypting.
                //
                // Frustratingly, in production Cloudflare ignores non-default ports. So we run
                // a small proxy server in `TaskRealtimeService` on port 80 that redirects to
                // the right port.
                //
                // eslint-disable-next-line cyberworlds/no-global-fetch
                return fetch(
                    `http://${taskRealtimeServiceHostname}:80/${taskRealtimeServicePort}/${spaceId}/loadQueries`,
                    {
                        method: "POST",
                        headers,
                        body: request.body,
                    },
                );
            }

            case "UploadFile":
            case "CreateFileMultipartUpload":
            case "PutFileMultipartUploadPart":
            case "CompleteFileMultipartUpload":
            case "UploadAvatar": {
                // Can't forward a request to upgrade to a WebSocket connection to
                // `FileProcessorService`. All WebSocket connection routes are enumerated above.
                if (request.headers.has("upgrade"))
                    throw new InvalidArgumentError("Can\u2019t upgrade to WebSocket connection");

                const createContext = ({sessionId, accountId}: SessionTokenPayload) =>
                    Context.new({
                        tracer: new TracerContextModule(span),
                        batch: BatchContextModule.new(),
                        // These upload file endpoints can't do anything harmful with a revoked
                        // session. Sure they can upload files to R2 but as soon as we try to make an
                        // RPC call to `AppService` it'll fail because we check if the session was
                        // revoked in `AppService`.
                        actor: SessionActorContextModule.dangerouslyNewWithoutCheckingIfRevoked(
                            "AppService",
                            sessionId,
                            accountId,
                        ),
                        rpc: new WorkerRpcContextModule(
                            new WorkerRpcContextBatcher({
                                protocol: url.protocol,
                                host: url.host,
                                tokenAgent,
                                cookieJar: new CookieJar(),
                            }),
                        ),
                    });

                switch (route.type) {
                    case "UploadFile": {
                        return uploadFile(
                            createContext,
                            executionContext,
                            env,
                            tokenAgent,
                            request,
                            url,
                            span,
                            route,
                        );
                    }
                    case "CreateFileMultipartUpload": {
                        return createFileMultipartUpload(
                            createContext,
                            executionContext,
                            env,
                            tokenAgent,
                            request,
                            url,
                            span,
                            route,
                        );
                    }
                    case "PutFileMultipartUploadPart": {
                        return putFileMultipartUploadPart(
                            createContext,
                            executionContext,
                            env,
                            tokenAgent,
                            request,
                            url,
                            span,
                            route,
                        );
                    }
                    case "CompleteFileMultipartUpload": {
                        return completeFileMultipartUpload(
                            createContext,
                            executionContext,
                            env,
                            tokenAgent,
                            request,
                            url,
                            span,
                            route,
                        );
                    }
                    case "UploadAvatar": {
                        return uploadAvatar(
                            createContext,
                            executionContext,
                            env,
                            tokenAgent,
                            request,
                            url,
                            span,
                            route.avatarEntityPath,
                        );
                    }
                    default:
                        throw exhaustive(route);
                }
            }

            //TODO(rmtobin, 2025-10-20, #files-edge-service): Remove this case once we've moved file serving to the files edge service
            // NOTE(calebmer, 2024-09-26): A minor optimization here would be to move file
            // serving to its own subdomain. For example, `static.alpine.inc`. That way the
            // browser wouldn't send session cookies to the subdomain. We use signed URLs
            // to authorize file requests, we don't need cookies.
            case "File": {
                // Can't forward a request to upgrade to a WebSocket connection to
                // `FileProcessorService`. All WebSocket connection routes are enumerated above.
                if (request.headers.has("upgrade"))
                    throw new InvalidArgumentError("Can\u2019t upgrade to WebSocket connection");

                return fetchFile(executionContext, env, tokenAgent, request, url, span, route);
            }

            //TODO(rmtobin, 2025-10-20, #files-edge-service): Remove this case once we've moved file serving to the files edge service
            // NOTE(calebmer, 2024-10-03): The `/files/cors-proxy/:url` route is used when
            // pasting files in content where we find that the file's source is some URL
            // outside our space (e.g. an `<img>` with a `src` tag pointing to some domain
            // that's not ours like https://unsplash.com). For these files we load the URL
            // on the client then send it to `FileProcessorService` to save in our databases.
            //
            // However, CORS is an issue here. The browser won't let us make HTTP requests
            // to domains from JavaScript that haven't explicitly allowed our domain in an
            // `Access-Control-Allow-Origin` header. This route is our dubious workaround.
            // We use `EdgeService` to proxy requests to arbitrary URLs so we can load them
            // on the client.
            //
            // A better solution might be to fetch the file in `FileProcessorService` and
            // save it to our database from there. However, I'm currently scared about the
            // security impact of making network requests to arbitrary domains from our EC2
            // instances given they're in public AWS VPC subnets. So the recipient of a
            // network request from `FileProcessorService` can figure out the IP address of our
            // server and perhaps start to devise attacks with that information.
            //
            // Instead we have this arbitrary `GET` request proxy in `EdgeService`. It
            // also seems dubious to me that we'd expose this proxy capability almost
            // completely unprotected. Could bad actors make use of a free internet proxy?
            // I'm not sure.
            //
            // Anyway, CORS is annoying. This approach may be a little dubious but it
            // works. We'll improve it later.
            case "FileCorsProxy": {
                if (request.headers.has("upgrade")) {
                    throw new InvalidArgumentError("Can\u2019t upgrade to WebSocket connection");
                }

                if (request.method !== "GET") {
                    throw new InvalidArgumentError("Only `GET` HTTP requests are supported");
                }

                let proxyUrl: URL;
                try {
                    proxyUrl = new URL(route.url);
                } catch {
                    throw new InvalidArgumentError("Invalid proxied URL format");
                }

                if (proxyUrl.protocol !== "http:" && proxyUrl.protocol !== "https:") {
                    throw new InvalidArgumentError("Unsupported proxied URL protocol");
                }

                // Let's make sure the request has a valid session cookie at least. Notably, we
                // don't check to see whether the session is still valid. So a bad actor could
                // be using a session cookie we've revoked and still access this endpoint.
                //
                // At least this makes this endpoint a little annoying for a bad actor to use
                // even if it doesn't really provide any meaningful protection.
                const sessionCookieToken = await getSessionCookieIfExists({
                    tokenAgent,
                    cookieNameSuffix: assertExists(
                        env.COOKIE_NAME_SUFFIX,
                        "Missing `COOKIE_NAME_SUFFIX` env variable",
                    ),
                    request,
                });
                if (!sessionCookieToken) throw unauthenticatedSessionError();

                const proxyHeaders = new Headers();

                for (const headerName of ["accept", "accept-encoding", "accept-language"]) {
                    const headerValue = request.headers.get(headerName);
                    if (headerValue !== null) {
                        proxyHeaders.set(headerName, headerValue);
                    }
                }

                // eslint-disable-next-line cyberworlds/no-global-fetch
                let response = await fetch(proxyUrl, {
                    method: "GET",
                    headers: proxyHeaders,
                });

                // Don't allow the proxied domain to set cookies with the `set-cookie` header.
                // This feels like it could be an attack vector though I can't currently think
                // of an attack that would use this ability.
                if (response.headers.has("set-cookie")) {
                    const responseHeaders = new Headers(response.headers);
                    responseHeaders.delete("set-cookie");

                    response = new Response(response.body, {
                        status: response.status,
                        headers: responseHeaders,
                    });
                }

                return response;
            }
            case "MeetCaleb": {
                return new Response(null, {
                    status: 302,
                    headers: {location: "https://calendar.app.google/ciE2PUEXvqcBE9iu5"},
                });
            }
            default:
                throw exhaustive(route);
        }
    }

    cast<"AppService">(route);

    // Can't forward a request to upgrade to a WebSocket connection to
    // `AppService`. All WebSocket connection routes are enumerated above.
    if (request.headers.has("upgrade")) {
        return new Response("400 Bad Request: Can\u2019t upgrade to WebSocket connection", {
            status: 400,
            headers: {"content-type": "text/plain"},
        });
    }

    const startTimeString = new Date(startTime).toISOString();

    const headers = new Headers(request.headers);
    addTracerPropagationContextHeader(headers, span);

    let response;

    {
        const appServiceStartTime = span.clock.now();

        // This forwards the request from `EdgeService` to `AppService` completely
        // untouched. To `AppService` it will look like the request is coming from a
        // web browser.
        //
        // eslint-disable-next-line cyberworlds/no-global-fetch
        response = await fetch(request, {headers});

        const appServiceEndTime = span.clock.now();

        // Record how much time just the fetch to `AppService` took.
        span.addData({edge: {appServiceDurationMs: appServiceEndTime - appServiceStartTime}});
    }

    // We retry some transient errors in `EdgeService`. Importantly, we want to
    // retry AWS ALB 504 errors. Or if a DynamoDB request timed out. We retry RPC
    // transient errors on the client (since retrying a batched RPC call in
    // `EdgeService` is rough). However, Remix requests (either document loads
    // directly from a browser or data requests on page navigation) we want to
    // retry in `EdgeService`. Since we don't have client control over the web
    // browser making the request!
    if (!response.ok && (await shouldRetryRequest(request, url, response))) {
        for (let attemptNumber = 1; attemptNumber <= 4; attemptNumber++) {
            response = await span.withSpan("Retry request", async span => {
                {
                    const delayMs = Math.min(2 ** attemptNumber * 20, 1000 * 10);

                    // We add jitter to our exponential backoff so that many requests retried at
                    // the same time do not cause the same resource contention which may have
                    // caused the errors in the first place.
                    // See: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter
                    const delayMsWithJitter = Math.floor(Math.random() * delayMs);

                    span.addData({common: {delayDurationMs: delayMsWithJitter}});
                    await wait(delayMsWithJitter);
                }

                const retryHeaders = new Headers(request.headers);
                addTracerPropagationContextHeader(retryHeaders, span);

                // eslint-disable-next-line cyberworlds/no-global-fetch
                return fetch(request, {headers: retryHeaders});
            });

            // If the retried request also has a transient error, then try again!
            if (!response.ok && (await shouldRetryRequest(request, url, response))) {
                continue;
            }

            // All good! Stop the retry loop.
            break;
        }

        // If we've exhausted all retries then we'll use the last response.
    }

    // If AWS ALB returns a 504 it's usually because the request timed out. Convert
    // ALB 504 HTML errors into a format our systems understand instead of the
    // default `text/html` format from AWS ALB.
    //
    // See: https://repost.aws/knowledge-center/504-error-alb
    if (response.status === 504) {
        const error = new DeadlineExceededError("Load balancer timed out request");
        span.addException(error);
        response = create504Response(url, error);
    }

    // Replace the `/*` route string with the route parsed by `AppService`. Given
    // the edge service span is usually the root span in our trace, having a more
    // specific span name is nice for our instrumentation tools.
    const actualRoute = response.headers.get("cyberworlds-route");
    if (actualRoute?.startsWith("/")) {
        span.addData({
            http: {route: actualRoute},
        });

        span.recklesslyOverrideName(
            `Handle: ${createTraceServerResponseHandleSpanName(
                span.getRoot(),
                request,
                actualRoute,
            )}`,
        );
    }

    // For HTML requests, include edge server timing information. We use this on
    // the client to synchronize our client time with the server time. See
    // `synchronized_system_clock.ts`.
    if (response.headers.get("content-type")?.includes("text/html")) {
        // `fetch()` responses are immutable so we need to clone to add a new header...
        response = new Response(response.body, response);

        const endTime = Date.now();
        const durationMs = endTime - startTime;

        response.headers.append(
            "server-timing",
            // eslint-disable-next-line cyberworlds/string-quotes
            `edge;dur=${durationMs};desc="Edge server wait (start time: ${startTimeString})"`,
        );
    }

    return response;
}

function create504Response(url: URL, error: unknown) {
    // Format as batch RPC endpoint error.
    if (url.pathname === "/api/rpc/_batch" || url.pathname === "/api/rpc/_batchByActor") {
        return new Response(
            JSON.stringify(
                RpcHttpBatchCallErrorOutputSchema.serialize({
                    ok: false,
                    error,
                }),
            ),
            {
                status: 504,
                headers: {"content-type": "application/json"},
            },
        );
    }

    // Format as RPC endpoint error.
    if (url.pathname.startsWith("/api/rpc/")) {
        return new Response(
            JSON.stringify(
                RpcHttpCallOutputSchema.serialize({
                    ok: false,
                    error,
                }),
            ),
            {
                status: 504,
                headers: {"content-type": "application/json"},
            },
        );
    }

    // Format as an auth endpoint error.
    if (url.pathname === "/api/auth/sign-in" || url.pathname === "/api/auth/sign-up") {
        return new Response(
            JSON.stringify(
                AuthSignInOrSignUpOutputSchema.serialize({
                    ok: false,
                    error,
                }),
            ),
            {
                status: 504,
                headers: {"content-type": "application/json"},
            },
        );
    }

    // Format as Remix data request error.
    //
    // Here's how Remix formats errors for `_data` requests:
    // https://github.com/remix-run/remix/blob/ff06e1656108bc21244e1fd4b33ed53e22b85158/packages/remix-server-runtime/server.ts#L321-L331
    //
    // We patch `serializeError()` to use `ErrorSchema.serialize()` instead of the
    // default logic:
    // https://github.com/cyberworlds/cyberworlds/blob/bcdab36de85de291297addb4ec68d1c3664e6bae/admin/patches/%40remix-run__server-runtime%402.9.2.patch#L111-L117
    //
    // Setting the `x-remix-error` header is important since that's how Remix
    // identifies, on the client, a formatted error response:
    // https://github.com/remix-run/remix/blob/ff06e1656108bc21244e1fd4b33ed53e22b85158/packages/remix-react/data.ts#L15-L17
    if (url.searchParams.has("_data")) {
        return new Response(JSON.stringify(ErrorSchema.serialize(error)), {
            status: 504,
            headers: {"content-type": "application/json", "x-remix-error": "yes"},
        });
    }

    return new Response("504 Gateway Timeout", {
        status: 504,
        headers: {"content-type": "text/plain"},
    });
}

async function shouldRetryRequest(
    request: Request,
    url: URL,
    response: Response,
): Promise<boolean> {
    // Response was successful, nothing to retry!
    if (response.ok) return false;

    // Only retry idempotent HTTP request methods.
    if (request.method !== "GET") return false;

    // Don't retry RPC requests. Our RPC clients handle RPC retries.
    if (url.pathname.startsWith("/api/rpc/")) return false;

    // Definitely retry AWS ALB 504 gateway timeout errors.
    if (response.status === 504) return true;

    // Check if this is an error response from a Remix data request by parsing the
    // response body.
    //
    // Here's how Remix formats errors for `_data` requests:
    // https://github.com/remix-run/remix/blob/ff06e1656108bc21244e1fd4b33ed53e22b85158/packages/remix-server-runtime/server.ts#L321-L331
    //
    // Remix's client error response checker function:
    // https://github.com/remix-run/remix/blob/ff06e1656108bc21244e1fd4b33ed53e22b85158/packages/remix-react/data.ts#L15-L17
    //
    // TODO(calebmer): We should probably retry Remix data requests on the client
    // (like we do for RPC calls) and only retry Remix document (`text/html`)
    // requests in `EdgeService` since we don't have client control over...the web
    // browser's URL input bar.
    if (url.searchParams.has("_data") && response.headers.get("x-remix-error") != null) {
        const clonedResponse = response.clone();

        // We patch `serializeError()` to use `ErrorSchema.serialize()` instead of the
        // default logic:
        // https://github.com/cyberworlds/cyberworlds/blob/bcdab36de85de291297addb4ec68d1c3664e6bae/admin/patches/%40remix-run__server-runtime%402.9.2.patch#L111-L117
        const error = ErrorSchema.deserialize(await clonedResponse.json());

        return isTransientError(error);
    }

    // `entry.server.tsx` sets this header if the response contains a transient
    // error. Will be set on `text/html` responses whose bodies we can't reasonably
    // parse here.
    return response.headers.get("cyberworlds-transient-error") === "yes";
}

// eslint-disable-next-line import/no-default-export
export default {fetch: handleFetch};

// We deploy our durable objects with our edge service but we think of our
// durable objects as logically different services. We could choose in the
// future to deploy them as separate Cloudflare Workers.
//
// We refer to the Cloudflare Worker which proxies our `AppService` as
// `EdgeService`. We refer to the broader collection of services owned by
// `EdgeService` as `EdgeServiceFamily`.
export {DocumentCollaborationDurableObject} from "~/server/documents/collaboration/document_collaboration_durable_object.js";
export {PostRealtimeDurableObject} from "~/server/forum/realtime/post_realtime_durable_object.js";
export {ChannelRealtimeDurableObject} from "~/server/forum/realtime/channel_realtime_durable_object.js";
export {ChatRealtimeDurableObject} from "~/server/chat/realtime/chat_realtime_durable_object.js";
export {MyAccountDurableObject} from "~/server/notifications/my_account/my_account_durable_object.js";
export {TaskNotesCollaborationDurableObject} from "~/server/tasks/notes_collaboration/task_notes_collaboration_durable_object.js";
