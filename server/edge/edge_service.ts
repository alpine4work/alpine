import {appStaticManifestPaths} from "~/app/static/app_static_manifest_paths.js";
import {fetchFromDurableObjectStub} from "~/server/cloudflare/fetch_from_durable_object_stub.js";
import {TaskRealtimeServiceEdgeRouter} from "~/server/edge/task_realtime_service_edge_router.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {getSessionCookieIfExists} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentPrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {TokenAgentPublicSide} from "~/server/tokens/token_agent_public_side.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {
    createTraceServerResponseHandleSpanName,
    traceServerResponse,
} from "~/server/tracer/trace_server_response.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {
    getFilePreviewImageResizeWidth,
    isFilePreviewImageResizeWidth,
} from "~/shared/files/get_file_preview_image_resize_width.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

type EdgeServiceEnv = {
    AppStaticBucket: R2Bucket;
    FilesBucket: R2Bucket;
    DocumentCollaborationDurableObjectNamespace: DurableObjectNamespace;
    PostRealtimeDurableObjectNamespace: DurableObjectNamespace;
    ChannelRealtimeDurableObjectNamespace: DurableObjectNamespace;
    ChatRealtimeDurableObjectNamespace: DurableObjectNamespace;
    MyAccountDurableObjectNamespace: DurableObjectNamespace;
    TaskNotesCollaborationDurableObjectNamespace: DurableObjectNamespace;
    APP_SERVICE_PUBLIC_KEY?: string;
    EDGE_SERVICE_FAMILY_PUBLIC_KEY?: string;
    TASK_REALTIME_SERVICE_PUBLIC_KEY?: string;
    JOB_QUEUE_SERVICE_PUBLIC_KEY?: string;
    FILE_UPLOAD_SERVICE_PUBLIC_KEY?: string;
    EDGE_SERVICE_FAMILY_PRIVATE_KEY?: string;
    TOKEN_AGENT_SECRET?: string;
    FILE_UPLOAD_SERVICE_HOSTNAME?: string;
    HONEYCOMB_API_KEY?: string;
};

// Cache some shared resources across requests.
let sharedResources: EdgeServiceSharedResources | null = null;

type EdgeServiceSharedResources = {
    env: EdgeServiceEnv;
    tokenAgentPromise: Promise<TokenAgent>;
    taskRealtimeServiceRouterPromise: Promise<TaskRealtimeServiceEdgeRouter>;
};

async function handleFetch(
    request: Request,
    env: EdgeServiceEnv,
    executionContext: ExecutionContext,
) {
    const startTime = Date.now();

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
    // Used by `synchronized_system_clock.ts`.
    //
    // [1]: https://en.wikipedia.org/wiki/Network_Time_Protocol
    // [2]: https://developers.cloudflare.com/workers/learning/security-model/
    if (url.pathname === "/api/time") {
        return new Response(`{"startTime":${startTime},"endTime":${Date.now()}}`, {
            status: 200,
            headers: {"content-type": "application/json"},
        });
    }

    // Fast path for static asset requests. We don't want to trace these requests
    // or perform any other request/response manipulation.
    //
    // NOTE(calebmer, 2024-09-26): A minor optimization here would be to move asset
    // serving to its own subdomain. For example, `static.alpine.inc`. That way the
    // browser wouldn't send session cookies to the subdomain. Some assets like
    // `favicon.ico` need to live on our root domain but all our JavaScript bundles
    // could go to `static.alpine.inc`.
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
            // eslint-disable-next-line no-global-fetch
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

    // Create a new tracer for every request because we need a Honeycomb client and
    // the Honeycomb client needs `executionContext.waitUntil()` which is request
    // scoped. Tracers are cheap to construct so this is fine.
    const tracer = createServerTracer({
        serviceName: "EdgeService",
        jsHost: "CloudflareWorker",
        honeycombApiKey: env.HONEYCOMB_API_KEY,
        waitUntil: promise => executionContext.waitUntil(promise),
    });

    let routeString = "/*";
    let route:
        | "AppService"
        | {type: "DocumentCollaborationService"; documentId: string; pathname: string}
        | {type: "PostRealtimeService"; postId: string; pathname: string}
        | {type: "ChannelRealtimeService"; channelId: string; pathname: string}
        | {type: "ChatRealtimeService"; chatId: string; pathname: string}
        | {type: "MyAccountService"; accountId: string; pathname: string}
        | {type: "TaskNotesCollaborationService"; taskId: string; pathname: string}
        | {type: "TaskRealtimeService"; spaceId: SpaceId}
        | {type: "UploadFile"; spaceId: SpaceId}
        | {type: "File"; spaceId: SpaceId; fileId: FileId; variant: "preview" | null} =
        "AppService";

    if (url.pathname.startsWith("/files/")) {
        const pathSegments = url.pathname.slice(7).split("/");

        if (pathSegments.length === 2 && isId<SpaceId>(pathSegments[0]!)) {
            const [fileId, variant] = pathSegments[1]!.split("-", 2);

            if (isId<FileId>(fileId!) && (variant === "preview" || variant === undefined)) {
                routeString = `/files/:spaceId/:fileId${variant ? `-${variant}` : ""}`;
                route = {type: "File", spaceId: pathSegments[0], fileId, variant: variant ?? null};
            }
        }
    } else if (!url.pathname.startsWith("/api/")) {
        // Route to `AppService`...
    } else if (url.pathname.startsWith("/api/durable-objects/")) {
        const pathSegments = url.pathname.slice(21).split("/");

        switch (pathSegments[0]) {
            case "documents": {
                const documentId = pathSegments[1];
                if (documentId === undefined) break;

                const pathname = `/${pathSegments.slice(2).join("/")}`;

                routeString = `/api/durable-objects/documents/:documentId${
                    pathname !== "/" ? "/*" : ""
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
    } else if (
        // TODO(calebmer, #files): Deploy `FileUploadService` to production.
        process.env.NODE_ENV === "development" &&
        url.pathname.startsWith("/api/files/")
    ) {
        const pathSegments = url.pathname.slice("/api/files/".length).split("/");
        if (
            pathSegments.length === 2 &&
            isId<SpaceId>(pathSegments[0]!) &&
            pathSegments[1] === "upload"
        ) {
            routeString = "/api/files/:spaceId/upload";
            route = {type: "UploadFile", spaceId: pathSegments[0]};
        }
    }

    return traceServerResponse(tracer, request, url, routeString, async (span, request) => {
        if (route !== "AppService") {
            // An env object that is referentially equal will be passed in as long as
            // environment variables remain the same.
            // https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#parameters
            if (sharedResources === null || sharedResources.env !== env) {
                const appServicePublicKey = env.APP_SERVICE_PUBLIC_KEY;
                if (!appServicePublicKey)
                    throw new InternalError("Missing `APP_SERVICE_PUBLIC_KEY` env variable");

                const edgeServiceFamilyPublicKey = env.EDGE_SERVICE_FAMILY_PUBLIC_KEY;
                if (!edgeServiceFamilyPublicKey)
                    throw new InternalError(
                        "Missing `EDGE_SERVICE_FAMILY_PUBLIC_KEY` env variable",
                    );

                const taskRealtimeServicePublicKey = env.TASK_REALTIME_SERVICE_PUBLIC_KEY;
                if (!taskRealtimeServicePublicKey)
                    throw new InternalError(
                        "Missing `TASK_REALTIME_SERVICE_PUBLIC_KEY` env variable",
                    );

                const jobQueueServicePublicKey = env.JOB_QUEUE_SERVICE_PUBLIC_KEY;
                if (!jobQueueServicePublicKey)
                    throw new InternalError("Missing `JOB_QUEUE_SERVICE_PUBLIC_KEY` env variable");

                const fileUploadServicePublicKey = env.FILE_UPLOAD_SERVICE_PUBLIC_KEY;
                if (!fileUploadServicePublicKey)
                    throw new InternalError(
                        "Missing `FILE_UPLOAD_SERVICE_PUBLIC_KEY` env variable",
                    );

                const edgeServiceFamilyPrivateKey = env.EDGE_SERVICE_FAMILY_PRIVATE_KEY;
                if (!edgeServiceFamilyPrivateKey)
                    throw new InternalError(
                        "Missing `EDGE_SERVICE_FAMILY_PRIVATE_KEY` env variable",
                    );

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
                        fileUploadServicePublicKey,
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
                case "DocumentCollaborationService": {
                    return fetchFromDurableObjectStub({
                        durableObjectNamespace: env.DocumentCollaborationDurableObjectNamespace,
                        serviceName: "DocumentCollaborationService",
                        tokenAgent,
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
                    const sessionCookieToken = await getSessionCookieIfExists(tokenAgent, request);
                    if (!sessionCookieToken) throw unauthenticatedSessionError();

                    const requestToken =
                        await tokenAgent.privateSide.dangerouslySignShortLivedToken(
                            "TaskRealtimeService",
                            sessionCookieToken,
                        );
                    headers.set("authorization", `bearer ${requestToken}`);

                    const taskRealtimeServiceHost =
                        await taskRealtimeServiceRouter.getStickySessionHost(
                            Context.new({
                                process: new ProcessContextModule({
                                    waitUntil: promise => executionContext.waitUntil(promise),
                                }),
                                tracer: new TracerContextModule(span),
                            }),
                            spaceId,
                            sessionCookieToken.sessionId,
                        );

                    if (process.env.NODE_ENV !== "production") {
                        // eslint-disable-next-line no-global-fetch
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
                    // eslint-disable-next-line no-global-fetch
                    return fetch(
                        `http://${taskRealtimeServiceHostname}:80/${taskRealtimeServicePort}/${spaceId}`,
                        {headers},
                    );
                }
                case "UploadFile": {
                    // Can't forward a request to upgrade to a WebSocket connection to
                    // `FileUploadService`. All WebSocket connection routes are enumerated above.
                    if (request.headers.has("upgrade")) {
                        return new Response(
                            "400 Bad Request: Can't upgrade to WebSocket connection",
                            {
                                status: 400,
                                headers: {"content-type": "text/plain"},
                            },
                        );
                    }

                    const fileUploadServiceHostname = env.FILE_UPLOAD_SERVICE_HOSTNAME;
                    if (!fileUploadServiceHostname)
                        throw new InternalError(
                            "Missing `FILE_UPLOAD_SERVICE_HOSTNAME` env variable",
                        );

                    const headers = new Headers(request.headers);
                    addTracerPropagationContextHeader(headers, span);

                    // We authenticate with an `Authorization` not a `Cookie` header.
                    headers.delete("cookie");

                    // When connecting to `FileUploadService` via the edge, you must authenticate
                    // with a session cookie. `Authorization` headers are ignored.
                    const sessionCookieToken = await getSessionCookieIfExists(tokenAgent, request);
                    if (!sessionCookieToken) throw unauthenticatedSessionError();

                    const requestToken =
                        await tokenAgent.privateSide.dangerouslySignShortLivedToken(
                            "FileUploadService",
                            sessionCookieToken,
                        );
                    headers.set("authorization", `bearer ${requestToken}`);

                    // eslint-disable-next-line no-global-fetch
                    return fetch(`http://${fileUploadServiceHostname}/${route.spaceId}/upload`, {
                        method: request.method,
                        headers,
                        body: request.body,
                    });
                }
                // NOTE(calebmer, 2024-09-26): A minor optimization here would be to move file
                // serving to its own subdomain. For example, `static.alpine.inc`. That way the
                // browser wouldn't send session cookies to the subdomain. We use signed URLs
                // to authorize file requests, we don't need cookies.
                case "File": {
                    // Can't forward a request to upgrade to a WebSocket connection to
                    // `FileUploadService`. All WebSocket connection routes are enumerated above.
                    if (request.headers.has("upgrade")) {
                        return new Response(
                            "400 Bad Request: Can't upgrade to WebSocket connection",
                            {
                                status: 400,
                                headers: {"content-type": "text/plain"},
                            },
                        );
                    }

                    return handleFileFetch(
                        executionContext,
                        sharedResources,
                        request,
                        url,
                        span,
                        route,
                    );
                }
                default:
                    throw exhaustive(route);
            }
        }

        // Can't forward a request to upgrade to a WebSocket connection to
        // `AppService`. All WebSocket connection routes are enumerated above.
        if (request.headers.has("upgrade")) {
            return new Response("400 Bad Request: Can't upgrade to WebSocket connection", {
                status: 400,
                headers: {"content-type": "text/plain"},
            });
        }

        const startTimeString = new Date(startTime).toISOString();

        const headers = new Headers(request.headers);
        addTracerPropagationContextHeader(headers, span);

        // This forwards the request from `EdgeService` to `AppService` completely
        // untouched. To `AppService` it will look like the request is coming from a
        // web browser.
        //
        // eslint-disable-next-line no-global-fetch
        const response = await fetch(request, {headers});

        // Replace the `/*` route string with the route parsed by `AppService`. Given
        // the edge service span is usually the root span in our trace, having a more
        // specific span name is nice for our instrumentation tools.
        const actualRoute = response.headers.get("cyberworlds-route");
        if (actualRoute?.startsWith("/")) {
            span.addData({
                http: {route: actualRoute},
            });

            span.recklesslyOverrideName(
                `Handle: ${createTraceServerResponseHandleSpanName(tracer, request, actualRoute)}`,
            );
        }

        // For HTML requests, include edge server timing information. We use this on
        // the client to synchronize our client time with the server time. See
        // `synchronized_system_clock.ts`.
        if (response.headers.get("content-type")?.includes("text/html")) {
            // `fetch()` responses are immutable so we need to clone to add a new header...
            const newResponse = new Response(response.body, response);

            const endTime = Date.now();
            const durationMs = endTime - startTime;

            newResponse.headers.append(
                "server-timing",
                `edge;dur=${durationMs};desc="Edge server wait (start time: ${startTimeString})"`,
            );

            return newResponse;
        }

        return response;
    });
}

async function handleFileFetch(
    executionContext: ExecutionContext,
    sharedResources: EdgeServiceSharedResources,
    request: Request,
    url: URL,
    span: TracerSpan,
    route: {spaceId: SpaceId; fileId: FileId; variant: "preview" | null},
) {
    try {
        const fileUploadServiceHostname = sharedResources.env.FILE_UPLOAD_SERVICE_HOSTNAME;
        if (!fileUploadServiceHostname)
            throw new InternalError("Missing `FILE_UPLOAD_SERVICE_HOSTNAME` env variable");

        const tokenAgent = await sharedResources.tokenAgentPromise;

        const signedUrl = new URL(url);

        // Don't include the `width` search parameter in the signed URL verification.
        // Clients are allowed to vary this argument.
        const widthString = signedUrl.searchParams.get("width");
        signedUrl.searchParams.delete("width");

        const width = widthString !== null ? parseInt(widthString, 10) : null;
        if (width !== null && !isFilePreviewImageResizeWidth(width)) {
            throw new InvalidArgumentError(
                `Search param "width" is not a valid resize width, the nearest valid resize width is ${getFilePreviewImageResizeWidth(
                    width,
                )}`,
            );
        }

        // Make sure the user is allowed to access this file by verifying the signed
        // URL. If the user tampered with the URL then we'll throw an error.
        try {
            await tokenAgent.publicSide.verifyUrl(signedUrl);
        } catch (error) {
            if (error instanceof PermissionDeniedError) {
                return new Response("401 Unauthorized", {
                    status: 401,
                    headers: {"content-type": "text/plain"},
                });
            }
        }

        const headers = new Headers(request.headers);
        addTracerPropagationContextHeader(headers, span);

        // We authenticate with an `Authorization` not a `Cookie` header.
        headers.delete("cookie");

        // Use a system actor for our resize action. We've already verified the user
        // has access to this URL after calling `verifyUrl()`.
        const token = await tokenAgent.privateSide.dangerouslySignShortLivedToken(
            "FileUploadService",
            {type: "System", spaceId: route.spaceId},
        );
        headers.set("authorization", `bearer ${token}`);

        const fileIdWithVariant =
            route.fileId + (route.variant !== null ? `-${route.variant}` : "");

        const subrequest = new Request(
            `http://${fileUploadServiceHostname}/${route.spaceId}/resize/${fileIdWithVariant}${
                width !== null ? `?width=${width}` : ""
            }`,
            {
                method: request.method,
                headers,
            },
        );

        // Use a cache specifically for files since we'll be saving private files to
        // this cache. We don't want to accidentally serve these files from another
        // request.
        //
        // TODO(calebmer, 2024-09-27): There's some improvements we can make to our
        // caching here to improve performance:
        //
        // 1. By using the Cloudflare Workers cache API we don't get [tiered
        //    caching][1].
        //
        // 2. How is concurrency handled? What if two users try to access a cached
        //    file at the same exact time. Ideally we only make one request to
        //    `FileUploadService` but unless Cloudflare is doing some intelligent
        //    request deduping behind the scenes this code will make two requests.
        //
        // [1]: https://developers.cloudflare.com/cache/how-to/tiered-cache
        const filesCache = await caches.open("files");

        let cachedResponse = await filesCache.match(subrequest);
        if (cachedResponse) {
            const cachedResponseHeaders = new Headers(cachedResponse.headers);

            // Make sure to switch the `public` `cache-control` directive back to
            // `private` before returning.
            const cacheControlResponseHeader = cachedResponseHeaders.get("cache-control");
            if (cacheControlResponseHeader) {
                cachedResponseHeaders.set(
                    "cache-control",
                    cacheControlResponseHeader.replace(
                        /((?:^|,) *)public( *(?:,|$))/,
                        "$1private$2",
                    ),
                );
            }

            return new Response(cachedResponse.body, {
                ...cachedResponse,
                headers: cachedResponseHeaders,
            });
        }

        let response: Response;

        // If a `width` search param wasn't provided then we return the file as-is
        // without resizing. So if `width` is non null then execute our resize
        // request against file upload service. Otherwise directly read the file
        // from R2.
        //
        // We use the resize request as a cache key regardless of whether we actually
        // need to execute the resize.
        if (width !== null) {
            // eslint-disable-next-line no-global-fetch
            response = await fetch(subrequest);
        } else {
            const object = await sharedResources.env.FilesBucket.get(
                `${route.spaceId}/${fileIdWithVariant}`,
            );
            if (!object) {
                response = new Response("404 Not Found", {
                    status: 404,
                    headers: {"content-type": "text/plain"},
                });
            } else {
                response = new Response(object.body, {
                    status: 200,
                    // We need to return the same headers between here and `resizeFile()` in
                    // `server/files/upload`. If you add a header here you should also add a
                    // header there.
                    headers: {
                        "content-type": assertExists(object.httpMetadata?.contentType),
                        "content-length": String(object.size),
                        // After resizing, the result should be cached.
                        //
                        // - `private`: A user can only see files they have access to. Don't store
                        //   files in a shared cache since an attacker may be able to see a file they
                        //   don't have access to.
                        //
                        // - `immutable`: Files are immutable after they've been uploaded. While
                        //   hitting this route will resize the file on demand causing the bytes to not
                        //   be strictly the same over time, the perceived result to the end user will
                        //   never change so it's safe to cache this response as an immutable value.
                        //
                        // - `max-age`: Keep our response cached for 30 days. It's fine to get rid of
                        //   the file after that and request again if needed.
                        "cache-control": `private, immutable, max-age=${60 * 60 * 24 * 30}`,
                    },
                });
            }
        }

        // Replace the `private` `cache-control` directive with `public`. It's safe to
        // cache files in `filesCache` since in order to access `filesCache` you must
        // have a valid signed URL when accessing this endpoint. We'll only generate
        // signed URLs when the user actually has access to a file.
        cachedResponse = response.clone();
        const cacheControlResponseHeader = cachedResponse.headers.get("cache-control");
        if (cacheControlResponseHeader) {
            cachedResponse.headers.set(
                "cache-control",
                cacheControlResponseHeader.replace(/((?:^|,) *)private( *(?:,|$))/, "$1public$2"),
            );
        }

        executionContext.waitUntil(filesCache.put(subrequest, cachedResponse));

        return response;
    } catch (error) {
        span.addException(error);

        let statusCode;
        let statusMessage;

        if (!isSystemError(error)) {
            statusCode = 400;
            statusMessage = "Bad Request";
        } else {
            statusCode = 500;
            statusMessage = "Internal Server Error";
        }

        return new Response(
            `${statusCode} ${statusMessage}: ${
                error instanceof Error ? error.message : String(error)
            }`,
            {
                status: statusCode,
                headers: {"content-type": "text/plain"},
            },
        );
    }
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
