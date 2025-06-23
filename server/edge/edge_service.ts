import {appStaticManifestPaths} from "~/app/static/app_static_manifest_paths.js";
import {WorkerSessionActorContextModule} from "~/server/cloudflare/context/worker_actor_context_module.js";
import {WorkerRpcContextModule} from "~/server/cloudflare/context/worker_rpc_context_module.js";
import {fetchFromDurableObjectStub} from "~/server/cloudflare/fetch_from_durable_object_stub.js";
import {EdgeServiceEnv} from "~/server/edge/edge_service_env.js";
import {fetchFile} from "~/server/edge/fetch_file.js";
import {
    completeFileMultipartUpload,
    createFileMultipartUpload,
    putFileMultipartUploadPart,
} from "~/server/edge/file_multipart_upload.js";
import {TaskRealtimeServiceEdgeRouter} from "~/server/edge/task_realtime_service_edge_router.js";
import {uploadFile} from "~/server/edge/upload_file.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {getSessionCookieIfExists} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentPrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {TokenAgentPublicSide} from "~/server/tokens/token_agent_public_side.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {
    createTraceServerResponseHandleSpanName,
    traceServerResponse,
} from "~/server/tracer/trace_server_response.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {CookieJar} from "~/shared/helpers/http/cookie_jar.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
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
    | {type: "FileCorsProxy"; url: string};

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
        // eslint-disable-next-line string-quotes
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

    // Optimization: In development, any requests that load a resource from Vite
    // should go directly to `AppService` and skip tracing. Without this, a
    // significant number of Honeycomb events come from Vite requests in
    // development environments.
    if (process.env.NODE_ENV === "development" && url.pathname.startsWith("/vite/")) {
        // eslint-disable-next-line no-global-fetch
        return fetch(request);
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
    }

    return traceServerResponse(tracer, request, url, routeString, async (span, request) => {
        try {
            // Important to `await` here so that our try/catch catches any errors
            // asynchronously thrown by this function.
            const response = await actuallyHandleFetch(
                request,
                env,
                executionContext,
                startTime,
                url,
                route,
                span,
            );

            return response;
        } catch (error) {
            span.addException(error);

            let status;
            let statusMessage;
            if (isSystemError(error)) {
                status = 500;
                statusMessage = "Internal Server Error";
            } else {
                status = 400;
                statusMessage = "Bad Request";
            }

            return new Response(
                `${status} ${statusMessage}${
                    process.env.NODE_ENV !== "production"
                        ? `\n\n${
                              error instanceof Error ? error.stack ?? error.message : String(error)
                          }`
                        : ""
                }`,
                {
                    status,
                    headers: {"content-type": "text/plain"},
                },
            );
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

                const requestToken = await tokenAgent.privateSide.dangerouslySignShortLivedToken(
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

            case "LoadTaskQueries": {
                // Can't forward a request to upgrade to a WebSocket connection to
                // this endpoint of `TaskRealtimeService`.
                if (request.headers.has("upgrade"))
                    throw new InvalidArgumentError("Can’t upgrade to WebSocket connection");

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
                const sessionCookieToken = await getSessionCookieIfExists(tokenAgent, request);

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
                    ? await taskRealtimeServiceRouter.getStickySessionHost(
                          routerContext,
                          spaceId,
                          sessionCookieToken.sessionId,
                      )
                    : // TODO(calebmer): Probably better to send anonymous actors to a sticky host as
                      // well based on `BrowserId`. Maybe we should always use `BrowserId` actually
                      // to simplify code.
                      await taskRealtimeServiceRouter.getRandomHost(routerContext, spaceId);

                if (process.env.NODE_ENV !== "production") {
                    // eslint-disable-next-line no-global-fetch
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
                // eslint-disable-next-line no-global-fetch
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
            case "CompleteFileMultipartUpload": {
                // Can't forward a request to upgrade to a WebSocket connection to
                // `FileProcessorService`. All WebSocket connection routes are enumerated above.
                if (request.headers.has("upgrade"))
                    throw new InvalidArgumentError("Can’t upgrade to WebSocket connection");

                const createContext = ({sessionId, accountId}: SessionTokenPayload) =>
                    Context.new({
                        tracer: new TracerContextModule(span),
                        actor: WorkerSessionActorContextModule.dangerouslyNew(
                            "AppService",
                            sessionId,
                            accountId,
                        ),
                        rpc: new WorkerRpcContextModule({
                            protocol: url.protocol,
                            host: url.host,
                            tokenAgent,
                            cookieJar: new CookieJar(),
                        }),
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
                    default:
                        throw exhaustive(route);
                }
            }

            // NOTE(calebmer, 2024-09-26): A minor optimization here would be to move file
            // serving to its own subdomain. For example, `static.alpine.inc`. That way the
            // browser wouldn't send session cookies to the subdomain. We use signed URLs
            // to authorize file requests, we don't need cookies.
            case "File": {
                // Can't forward a request to upgrade to a WebSocket connection to
                // `FileProcessorService`. All WebSocket connection routes are enumerated above.
                if (request.headers.has("upgrade"))
                    throw new InvalidArgumentError("Can’t upgrade to WebSocket connection");

                return fetchFile(executionContext, env, tokenAgent, request, url, span, route);
            }

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
                    throw new InvalidArgumentError("Can’t upgrade to WebSocket connection");
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
                const sessionCookieToken = await getSessionCookieIfExists(tokenAgent, request);
                if (!sessionCookieToken) throw unauthenticatedSessionError();

                const proxyHeaders = new Headers();

                for (const headerName of ["accept", "accept-encoding", "accept-language"]) {
                    const headerValue = request.headers.get(headerName);
                    if (headerValue !== null) {
                        proxyHeaders.set(headerName, headerValue);
                    }
                }

                // eslint-disable-next-line no-global-fetch
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
            default:
                throw exhaustive(route);
        }
    }

    // Can't forward a request to upgrade to a WebSocket connection to
    // `AppService`. All WebSocket connection routes are enumerated above.
    if (request.headers.has("upgrade")) {
        return new Response("400 Bad Request: Can’t upgrade to WebSocket connection", {
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
        const newResponse = new Response(response.body, response);

        const endTime = Date.now();
        const durationMs = endTime - startTime;

        newResponse.headers.append(
            "server-timing",
            // eslint-disable-next-line string-quotes
            `edge;dur=${durationMs};desc="Edge server wait (start time: ${startTimeString})"`,
        );

        return newResponse;
    }

    return response;
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
