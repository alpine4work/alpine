import {getSessionIfExists} from "~/server/accounts/accounts_actions.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    ActorContextModule,
    AnonymousActorContextModule,
    BotActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/spaces_table.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    InvalidArgumentError,
    PermissionDeniedError,
    UnauthenticatedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
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
            return await createDynamoActorSessionContextModule(
                context,
                requestHeaders,
                tokenAgent,
                spaceId,
                {serviceName, authorizationHeaderPayload},
            );
        }
        case "System": {
            if (spaceId !== authorizationHeaderPayload.spaceId) {
                throw new PermissionDeniedError("System actor doesn’t have access to space");
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
    spaceId?: SpaceId,
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

    // Optimization: When loading our session from the database, also attempt to
    // load whether the account associated with the session is a member of the
    // space we're in.
    const spaceIdPromiseItem = spaceId
        ? () =>
              isAccountMemberOfSpaceWithoutAuthorization(
                  context,
                  spaceId,
                  authorizationHeaderPayload.accountId,
              )
        : () => {};

    const [session] = await runAllPromises([
        getSessionIfExists(
            context,
            authorizationHeaderPayload.sessionId,
            authorizationHeaderPayload.accountId,
        ),
        spaceIdPromiseItem(),
    ]);

    if (!session) {
        throw new PermissionDeniedError("Session not found");
    }
    return SessionActorContextModule.dangerouslyNewWithoutCheckingIfRevoked(
        serviceName,
        session.id,
        session.accountId,
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
