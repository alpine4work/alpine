import {Session} from "~/server/accounts/accounts_table.js";
import {
    DynamoActorContextModule,
    DynamoAnonymousActorContextModule,
    DynamoSessionActorContextModule,
    DynamoSystemActorContextModule,
} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerActionContextBase} from "~/server/context/server_action_context.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/spaces_table.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {
    InvalidArgumentError,
    PermissionDeniedError,
    UnauthenticatedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Create a `DynamoActorContextModule` from an HTTP `Authorization` header.
 */
export async function createDynamoActorContextModule(
    context: ServerActionContextBase,
    requestHeaders: Headers,
    tokenAgent: TokenAgent,
    spaceId: SpaceId,
): Promise<DynamoActorContextModule> {
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

    switch (authorizationHeaderPayload.type) {
        case "Session": {
            const [session] = await runAllPromises([
                Session.getIfExists(
                    context,
                    authorizationHeaderPayload.sessionId,
                    authorizationHeaderPayload.accountId,
                ),
                // Optimization: When loading our session from the database, also attempt to
                // load whether the account associated with the session is a member of the
                // space we're in.
                isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    spaceId,
                    authorizationHeaderPayload.accountId,
                ),
            ]);

            if (!session) {
                throw new PermissionDeniedError("Session not found");
            }
            return DynamoSessionActorContextModule.dangerouslyNew(serviceName, session);
        }
        case "System": {
            if (spaceId !== authorizationHeaderPayload.spaceId) {
                throw new PermissionDeniedError("System actor doesn’t have access to space");
            }
            return DynamoSystemActorContextModule.dangerouslyNew(
                serviceName,
                authorizationHeaderPayload.spaceId,
            );
        }
        case "Anonymous": {
            return DynamoAnonymousActorContextModule.dangerouslyNew(serviceName);
        }
        default:
            throw exhaustive(authorizationHeaderPayload);
    }
}
