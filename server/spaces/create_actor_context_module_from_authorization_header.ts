import {getSessionIfExists} from "~/server/accounts/get_session_if_exists.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    ActorContextModule,
    AnonymousActorContextModule,
    BotActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    InternalError,
    InvalidArgumentError,
    PermissionDeniedError,
    UnauthenticatedError,
} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Create a `ActorContextModule` from an HTTP `Authorization` header.
 */
export async function createActorContextModuleFromAuthorizationHeader(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    requestHeaders: Headers,
    tokenAgent: TokenAgent,
    spaceId: SpaceId,
): Promise<ActorContextModule> {
    const {serviceName, authorizationHeaderPayload} =
        await getAuthorizationPayloadAndServiceNameFromHeaders(requestHeaders, tokenAgent);

    switch (authorizationHeaderPayload.type) {
        case "Session": {
            return createDynamoActorSessionContextModule(context, requestHeaders, tokenAgent, {
                serviceName,
                authorizationHeaderPayload,
            });
        }
        case "System": {
            if (spaceId !== authorizationHeaderPayload.spaceId) {
                throw new PermissionDeniedError("System actor doesn\u2019t have access to space");
            }
            return SystemActorContextModule.dangerouslyNew(
                serviceName,
                authorizationHeaderPayload.spaceId,
            );
        }
        case "Anonymous": {
            return AnonymousActorContextModule.dangerouslyNew(serviceName);
        }
        case "Bot": {
            // We trust the token payload. We assume bot tokens are:
            //
            // 1. Signed with short lifetimes (a couple hours at most)
            // 2. Include a bot `accountId`
            //
            // Unlike sessions where we need to keep checking the database to see if the
            // session has been revoked.
            return BotActorContextModule.dangerouslyNew(
                serviceName,
                authorizationHeaderPayload.spaceId,
                authorizationHeaderPayload.accountId,
                authorizationHeaderPayload.scope,
            );
        }
        default:
            throw exhaustive(authorizationHeaderPayload);
    }
}

export async function createDynamoActorSessionContextModule(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    requestHeaders: Headers,
    tokenAgent: TokenAgent,
    parsedHeaders?: {
        serviceName: TokenServiceName;
        authorizationHeaderPayload: SessionTokenPayload;
    },
) {
    const {serviceName, authorizationHeaderPayload} =
        parsedHeaders ??
        (await getAuthorizationPayloadAndServiceNameFromHeaders(requestHeaders, tokenAgent));

    if (authorizationHeaderPayload.type !== "Session") {
        throw new PermissionDeniedError(
            quote`Cannot create session actor from non-session token: ${authorizationHeaderPayload.type}`,
        );
    }

    const sessionAccountId = await getSessionIfExists(
        context,
        authorizationHeaderPayload.sessionId,
    );

    if (sessionAccountId === null) {
        throw new PermissionDeniedError("Session not found");
    }

    if (sessionAccountId !== authorizationHeaderPayload.accountId) {
        throw new InternalError(
            "`Authorization` header `AccountId` doesn\u2019t match session `AccountId`",
        );
    }

    return SessionActorContextModule.dangerouslyNewWithoutCheckingIfRevoked(
        serviceName,
        authorizationHeaderPayload.sessionId,
        sessionAccountId,
    );
}

async function getAuthorizationPayloadAndServiceNameFromHeaders(
    requestHeaders: Headers,
    tokenAgent: TokenAgent,
) {
    const authorizationHeader = requestHeaders.get("authorization");
    if (!authorizationHeader) throw new UnauthenticatedError("Expected an `Authorization` header");

    const authorizationHeaderMatch = authorizationHeader.match(/^bearer (.+)$/i);

    if (!authorizationHeaderMatch) {
        throw new InvalidArgumentError(
            "Expected `Authorization` header to have `Bearer` authentication scheme",
        );
    }

    const authorizationHeaderToken = authorizationHeaderMatch[1] ?? "";
    const {serviceName, payload: authorizationHeaderPayload} =
        await tokenAgent.publicSide.verifyToken(authorizationHeaderToken);

    return {serviceName, authorizationHeaderPayload};
}
