import {appStaticManifestPaths} from "~/app/static/app_static_manifest_paths.js";
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
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, AvatarId, FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

let sharedResources: ResourceServiceSharedResources | null = null;

type ResourceServiceSharedResources = {
    env: ResourceServiceEnv;
    tokenAgentPromise: Promise<TokenAgent>;
};

type ResourceServiceRoute =
    | {type: "Upload"; spaceId: SpaceId; fileId: FileId}
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
    | {type: "HealthCheck"}
    | {type: "NotFound"};

// This is the list of all possible routes that this service can handle. Patterns are evaluated in order and the first match is used.
const routeMap: ReadonlyArray<{
    readonly pattern: URLPattern;
    readonly getRoute: (
        patternGroups: URLPatternURLPatternResult["pathname"]["groups"],
    ) => ResourceServiceRoute | null;
}> = [
    {
        pattern: new URLPattern({pathname: "/uploads/:spaceId/:fileId"}),
        getRoute: patternGroups => {
            if (!isId<SpaceId>(patternGroups.spaceId!) || !isId<FileId>(patternGroups.fileId!)) {
                return null;
            }
            return {
                type: "Upload",
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

    // Fast path for static asset requests. We don't want to trace these requests
    // or perform any other request/response manipulation.
    if (appStaticManifestPaths.has(url.pathname) || url.pathname.startsWith("/assets/")) {
        return fetchAppStaticFile(request, env, executionContext, url);
    }

    // Create a new tracer for every request because we need a Honeycomb client and
    // the Honeycomb client needs `executionContext.waitUntil()` which is request
    // scoped. Tracers are cheap to construct so this is fine.
    const tracer = createServerTracer({
        serviceName: "ResourceService",
        jsHost: "CloudflareWorker",
        honeycombApiKey: env.HONEYCOMB_API_KEY,
        waitUntil: promise => executionContext.waitUntil(promise),
    });

    let routeString: string | null = null;
    let route: ResourceServiceRoute;

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

    // We end up here if the path matched one or more patterns but none of the routes were actually valid
    if (!routeString) {
        routeString = "/*";
        route = {type: "NotFound"};
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
            return createSimpleErrorResponse(error);
        }
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
        throw new InvalidArgumentError("Can’t upgrade to WebSocket connection");
    }

    switch (route.type) {
        case "AccountAvatar":
        case "SpaceAvatar": {
            return fetchAvatar(executionContext, env, tokenAgent, request, url, span, route);
        }
        case "Upload": {
            return fetchUploadedFile(executionContext, env, tokenAgent, request, url, span, route);
        }
        case "HealthCheck": {
            return new Response("200 OK", {status: 200, headers: {"content-type": "text/plain"}});
        }
        case "NotFound": {
            return new Response("404 Not Found", {
                status: 404,
                headers: {"content-type": "text/plain"},
            });
        }
        default:
            throw exhaustive(route);
    }
}

// eslint-disable-next-line import/no-default-export
export default {fetch: handleFetch};
