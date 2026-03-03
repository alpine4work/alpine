import {appStaticManifestPaths} from "~/app/static/app_static_manifest_paths.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {fetchAppStaticFile} from "~/server/resources/fetch_app_static_file.js";
import {fetchAvatar} from "~/server/resources/fetch_avatar.js";
import {fetchUploadedFile} from "~/server/resources/fetch_uploaded_file.js";
import {ResourceServiceEnv} from "~/server/resources/resource_service_env.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentPrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {TokenAgentPublicSide} from "~/server/tokens/token_agent_public_side.js";
import {createServerTracer} from "~/server/tracer/server_tracer.js";
import {traceServerResponse} from "~/server/tracer/trace_server_response.js";
import {
    AvatarEntityPath,
    AvatarVariant,
    isAvatarVariant,
} from "~/shared/avatar/avatar_entity_path.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {canonicalizeFileContentTypeIfExists} from "~/shared/files/file_content_type.js";
import {getContentFileDownloadNameFromContentType} from "~/shared/files/get_content_file_download_name_from_content_type.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, AvatarId, BotId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

let sharedResources: ResourceServiceSharedResources | null = null;

type ResourceServiceSharedResources = {
    env: ResourceServiceEnv;
    tokenAgentPromise: Promise<TokenAgent>;
};

type ResourceServiceRoute =
    | {type: "File"; spaceId: SpaceId; fileId: FileId}
    | {type: "FileDownload"; spaceId: SpaceId; fileId: FileId}
    | {
          type: "AccountAvatar";
          avatarEntityPath: AvatarEntityPath;
          avatarId: AvatarId;
          variant: AvatarVariant;
      }
    | {
          type: "SpaceAvatar";
          avatarEntityPath: AvatarEntityPath;
          avatarId: AvatarId;
          variant: AvatarVariant;
      }
    | {
          type: "BotAvatar";
          avatarEntityPath: AvatarEntityPath;
          avatarId: AvatarId;
          variant: AvatarVariant;
      }
    | {type: "HealthCheck"}
    | {type: "NotFound"};

// This is the list of all possible routes that this service can handle. Patterns
// are evaluated in order and the first match is used.
const routeMap: ReadonlyArray<{
    readonly pattern: URLPattern;
    readonly getRoute: (
        patternGroups: URLPatternURLPatternResult["pathname"]["groups"],
    ) => ResourceServiceRoute | null;
}> = [
    {
        pattern: new URLPattern({pathname: "/files/:spaceId/:fileId"}),
        getRoute: patternGroups => {
            if (!isId<SpaceId>(patternGroups.spaceId!) || !isId<FileId>(patternGroups.fileId!)) {
                return null;
            }
            return {
                type: "File",
                spaceId: patternGroups.spaceId,
                fileId: patternGroups.fileId,
            };
        },
    },
    {
        pattern: new URLPattern({pathname: "/download/files/:spaceId/:fileId"}),
        getRoute: patternGroups => {
            if (!isId<SpaceId>(patternGroups.spaceId!) || !isId<FileId>(patternGroups.fileId!)) {
                return null;
            }
            return {
                type: "FileDownload",
                spaceId: patternGroups.spaceId,
                fileId: patternGroups.fileId,
            };
        },
    },
    {
        pattern: new URLPattern({
            pathname: "/avatars/account/:accountId/:avatarIdWithOptionalVariant",
        }),
        getRoute: patternGroups => {
            const {accountId, avatarIdWithOptionalVariant} = patternGroups;
            const [avatarId, variant] = avatarIdWithOptionalVariant!.split("-");
            if (
                !isId<AccountId>(accountId!) ||
                !isId<AvatarId>(avatarId!) ||
                !isAvatarVariant(variant!)
            ) {
                return null;
            }
            return {
                type: "AccountAvatar",
                avatarEntityPath: `account/${accountId}`,
                avatarId,
                variant,
            };
        },
    },
    {
        pattern: new URLPattern({pathname: "/avatars/space/:spaceId/:avatarIdWithOptionalVariant"}),
        getRoute: patternGroups => {
            const {spaceId, avatarIdWithOptionalVariant} = patternGroups;
            const [avatarId, variant] = avatarIdWithOptionalVariant!.split("-");
            if (
                !isId<SpaceId>(spaceId!) ||
                !isId<AvatarId>(avatarId!) ||
                !isAvatarVariant(variant!)
            ) {
                return null;
            }
            return {
                type: "SpaceAvatar",
                avatarEntityPath: `space/${spaceId}`,
                avatarId,
                variant,
            };
        },
    },
    {
        pattern: new URLPattern({pathname: "/avatars/bot/:botId/:avatarIdWithOptionalVariant"}),
        getRoute: patternGroups => {
            const {botId, avatarIdWithOptionalVariant} = patternGroups;
            const [avatarId, variant] = avatarIdWithOptionalVariant!.split("-");
            if (!isId<BotId>(botId!) || !isId<AvatarId>(avatarId!) || !isAvatarVariant(variant!)) {
                return null;
            }
            return {
                type: "BotAvatar",
                avatarEntityPath: `bot/${botId}`,
                avatarId,
                variant,
            };
        },
    },
    {
        pattern: new URLPattern({pathname: "/healthcheck"}),
        getRoute: () => {
            return {type: "HealthCheck"};
        },
    },
    {
        pattern: new URLPattern({pathname: "/*"}),
        getRoute: () => {
            return {type: "NotFound"};
        },
    },
];

async function handleFetch(
    request: Request,
    env: ResourceServiceEnv,
    executionContext: ExecutionContext,
) {
    const startTime = Date.now();

    const url = new URL(request.url);

    // Fast path for static asset requests. We don't want to trace these requests or
    // perform any other request/response manipulation.
    if (appStaticManifestPaths.has(url.pathname) || url.pathname.startsWith("/assets/")) {
        return fetchAppStaticFile(request, env, executionContext, url);
    }

    // TODO(ifitzsimmons, #local-kinesis): This will eventually be required. For now,
    // there is no local Kinesis stream so we don't need to pass in a stream name.
    const streamName = env.KINESIS_TRACER_STREAM_NAME;
    if (!streamName && process.env.NODE_ENV === "production")
        throw new InternalError("Must provide `KINESIS_TRACER_STREAM_NAME` in production");

    // Create a new tracer for every request because we need a Honeycomb client and the
    // Honeycomb client needs `executionContext.waitUntil()` which is request scoped.
    // Tracers are cheap to construct so this is fine.
    const tracer = createServerTracer({
        serviceName: "ResourceService",
        jsHost: "CloudflareWorker",
        honeycombApiKey: env.HONEYCOMB_API_KEY,
        honeycombDataset: "resource-service",
        waitUntil: promise => executionContext.waitUntil(promise),
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

    let routeString: string | null = null;
    let route: ResourceServiceRoute | undefined;

    for (const {pattern, getRoute} of routeMap) {
        const match = pattern.exec({pathname: url.pathname});
        if (match) {
            const parsedRoute = getRoute(match.pathname.groups);
            if (parsedRoute) {
                route = parsedRoute;
                routeString = pattern.pathname;
                break;
            }
        }
    }

    // We end up here if the path matched one or more patterns but none of the routes
    // were actually valid
    if (!routeString || !route) {
        routeString = "/*";
        route = {type: "NotFound"};
    }

    return traceServerResponse(tracer, request, url, routeString, async (span, request) => {
        let response;

        try {
            // Important to `await` here so that our try/catch catches any errors
            // asynchronously thrown by this function.
            response = await actuallyHandleFetch(
                request,
                env,
                executionContext,
                startTime,
                url,
                route,
                span,
            );
        } catch (error) {
            span.addException(error);
            response = createSimpleErrorResponse(error);
        }

        const responseHeaders = new Headers(response.headers);

        // Add CORS headers to the response for trusted domains. Only origins that are in
        // the trusted domains can access files via CORS mode.
        const origin = request.headers.get("Origin");
        const trustedOrigins = env.CORS_TRUSTED_ORIGINS ?? [];

        // If there is no origin header, then this isn't a CORS request
        if (origin && trustedOrigins.includes(origin)) {
            responseHeaders.set("Access-Control-Allow-Origin", origin);
        }

        // Ensure if the origin changes, the browser will re-fetch the resource. Important
        // particularly if a request previously had no origin (no-cors) and now has one
        // (cors) as the browser will otherwise use a cached no-cors request for a cors
        // request to the same resource.
        responseHeaders.set("Vary", "Origin");

        switch (route.type) {
            case "AccountAvatar":
            case "BotAvatar":
            case "SpaceAvatar": {
                // This header will allow no-cors requests from outside the same site as the
                // request origin. Useful for embedding avatars in emails.
                responseHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
                break;
            }
            case "File":
            case "FileDownload":
            case "HealthCheck":
            case "NotFound": {
                // This header will prevent no-cors requests from outside the same site as the
                // request origin.
                responseHeaders.set("Cross-Origin-Resource-Policy", "same-site");
                break;
            }
            default:
                throw exhaustive(route);
        }

        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders,
        });
    });
}

async function actuallyHandleFetch(
    request: Request,
    env: ResourceServiceEnv,
    executionContext: ExecutionContext,
    startTime: number,
    url: URL,
    route: ResourceServiceRoute,
    span: TracerSpan,
) {
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

        const resourceServicePrivateKey = env.RESOURCE_SERVICE_PRIVATE_KEY;
        if (!resourceServicePrivateKey)
            throw new InternalError("Missing `RESOURCE_SERVICE_PRIVATE_KEY` env variable");

        const tokenAgentSecret = env.TOKEN_AGENT_SECRET;
        if (!tokenAgentSecret) throw new InternalError("Missing `TOKEN_AGENT_SECRET` env variable");

        const tokenAgentPromise = runAllPromises([
            TokenAgentPublicSide.new({
                serviceName: "ResourceService",
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
                serviceName: "ResourceService",
                servicePrivateKey: resourceServicePrivateKey,
                secret: tokenAgentSecret,
            }),
        ]).then(([publicSide, privateSide]) => ({publicSide, privateSide}));

        const ourSharedResources: typeof sharedResources = {
            env,
            tokenAgentPromise,
        };

        sharedResources = ourSharedResources;
    }

    const tokenAgent = await sharedResources.tokenAgentPromise;

    if (request.headers.has("upgrade")) {
        throw new InvalidArgumentError("Can\u2019t upgrade to WebSocket connection");
    }

    let response: Response;

    switch (route.type) {
        case "AccountAvatar":
        case "BotAvatar":
        case "SpaceAvatar": {
            response = await fetchAvatar(
                executionContext,
                env,
                tokenAgent,
                request,
                url,
                span,
                route,
            );
            break;
        }
        case "File": {
            response = await fetchUploadedFile(
                executionContext,
                env,
                tokenAgent,
                request,
                url,
                span,
                route,
            );
            break;
        }
        // We separate out the download route from the File route so we can set the
        // `Content-Disposition` header to force the browser to download the file instead
        // of navigating to it. This is to get around the fact that cross-origin requests
        // are not supported from anchor tags with the `download` attribute.[1]
        //
        // [1]: https://chromestatus.com/feature/4969697975992320
        case "FileDownload": {
            // Strip out the `/download` prefix from the URL so the signature is valid.
            const fileUrl = new URL(`/files/${route.spaceId}/${route.fileId}${url.search}`, url);
            response = await fetchUploadedFile(
                executionContext,
                env,
                tokenAgent,
                request,
                fileUrl,
                span,
                route,
            );

            if (response.ok) {
                const contentType = response.headers.get("Content-Type");
                if (!contentType) {
                    throw new InternalError(
                        "Missing `Content-Type` header in file download response",
                    );
                }

                const canonicalizedContentType = canonicalizeFileContentTypeIfExists(contentType);
                if (!canonicalizedContentType) {
                    throw new InternalError(
                        "Unsupported `Content-Type` header in file download response",
                    );
                }

                const filename =
                    getContentFileDownloadNameFromContentType(canonicalizedContentType);
                // eslint-disable-next-line cyberworlds/string-quotes
                response.headers.set("Content-Disposition", `attachment; filename="${filename}"`);
            }

            break;
        }
        case "HealthCheck": {
            response = new Response("200 OK", {
                status: 200,
                headers: {"content-type": "text/plain"},
            });
            break;
        }
        case "NotFound": {
            response = new Response("404 Not Found", {
                status: 404,
                headers: {"content-type": "text/plain"},
            });
            break;
        }
        default:
            throw exhaustive(route);
    }

    return response;
}

// eslint-disable-next-line import/no-default-export
export default {fetch: handleFetch};
