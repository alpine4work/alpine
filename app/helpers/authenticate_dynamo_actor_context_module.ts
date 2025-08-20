import {Session} from "~/server/accounts/accounts_actions.js";
import {
    DynamoActorContextModule,
    DynamoAnonymousActorContextModule,
    DynamoSessionActorContextModule,
    DynamoSystemActorContextModule,
} from "~/server/context/dynamo_actor_context_module.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/spaces_table.js";
import {SessionCookie} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Authenticates using the information from an HTTP request to create a
 * `DynamoActorContextModule` which will be used for checking permissions
 * throughout the rest of our code.
 *
 * Clients can authenticate with our app service in one of two ways:
 *
 * 1. Session cookie authentication. This is what web browsers use. We put a
 *    token in an HTTP only cookie and that token identifies the user. Only
 *    tokens issued by `AppService` are accepted in the session cookie. You can
 *    only authenticate as an account session with this method.
 *
 * 2. Authorization header authentication. This is what HTTP clients use. They
 *    put a token in an "Authorization" HTTP header. This is how the edge
 *    service family executes RPCs against our app service. You can
 *    authenticate as a session or system actor through an authorization header.
 */
export async function authenticateDynamoActorContextModule(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    {
        tokenAgent,
        sessionCookie,
        authorizationHeader,
        spaceIdHint,
    }: {
        tokenAgent: TokenAgent;
        sessionCookie: SessionCookie | null;
        authorizationHeader: string | null;
        spaceIdHint: SpaceId | null;
    },
): Promise<DynamoActorContextModule> {
    const sessionCookiePayload = await sessionCookie?.getIfExists();

    // Optimization: When loading our session from the database, also attempt to
    // load whether the account associated with the session is a member of the
    // space we're in. We try to determine the `SpaceId` we're in through various
    // hint heuristics. It's not required that we know the `SpaceId` here, if we
    // don't know the `SpaceId` we'll authorize the account later.
    const getSessionIfExists = async (
        sessionId: SessionId,
        accountId: AccountId,
    ): Promise<Session | null> => {
        if (!spaceIdHint) {
            return Session.getIfExists(context, sessionId, accountId);
        }

        const [session] = await runAllPromises([
            Session.getIfExists(context, sessionId, accountId),
            // This function caches its result for the duration of the request. Which is
            // why we can call it here and ignore the output.
            isAccountMemberOfSpaceWithoutAuthorization(context, spaceIdHint, accountId),
        ]);

        return session;
    };

    if (sessionCookiePayload && authorizationHeader) {
        throw new InvalidArgumentError(
            "Can’t provide both an `Authorization` header and a session cookie",
        );
    }

    // 1. Session cookie authentication
    if (sessionCookiePayload) {
        const session = await getSessionIfExists(
            sessionCookiePayload.sessionId,
            sessionCookiePayload.accountId,
        );
        if (!session) {
            // Remove our session cookie if the session was deleted from the database.
            sessionCookie!.dangerouslySet(null);
            return DynamoAnonymousActorContextModule.dangerouslyNew("AppClient");
        }

        // If we receive a session cookie, we treat the request as if it came from a
        // user's web browser and use the `AppClient` service name.
        return DynamoSessionActorContextModule.dangerouslyNew("AppClient", session);
    }

    // 2. Authorization header authentication
    if (authorizationHeader) {
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
                const session = await getSessionIfExists(
                    authorizationHeaderPayload.sessionId,
                    authorizationHeaderPayload.accountId,
                );
                if (!session) {
                    throw new PermissionDeniedError("Session not found");
                }
                return DynamoSessionActorContextModule.dangerouslyNew(serviceName, session);
            }
            case "System": {
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

    // 3. If we don't have a session cookie or `Authorization` header then this is
    //    an anonymous request.
    return DynamoAnonymousActorContextModule.dangerouslyNew("AppClient");
}
