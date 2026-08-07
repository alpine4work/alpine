import {getSessionIfExists} from "~/server/accounts/get_session_if_exists.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    ActorContextModule,
    AnonymousActorContextModule,
    BotActorContextModule,
    ImpersonatedAccountActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {SessionCookie} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    InternalError,
    InvalidArgumentError,
    PermissionDeniedError,
} from "~/shared/error/error.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Authenticates using the information from an HTTP request to create a
 * `ActorContextModule` which will be used for checking permissions throughout the
 * rest of our code.
 *
 * Clients can authenticate with our app service in one of two ways:
 *
 * 1. Session cookie authentication. This is what web browsers use. We put a token
 *    in an HTTP only cookie and that token identifies the user. Only tokens issued
 *    by `AppService` are accepted in the session cookie. You can only authenticate
 *    as an account session with this method.
 *
 * 2. Authorization header authentication. This is what HTTP clients use. They put
 *    a token in an "Authorization" HTTP header. This is how the edge service
 *    family executes RPCs against our app service. You can authenticate as a
 *    session, system, or bot actor through an authorization header.
 */
export async function authenticateActorContextModule(
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
    }: {
        tokenAgent: TokenAgent;
        sessionCookie: SessionCookie | null;
        authorizationHeader: string | null;
    },
): Promise<ActorContextModule> {
    const sessionCookiePayload = await sessionCookie?.getIfExists();

    if (sessionCookiePayload && authorizationHeader) {
        throw new InvalidArgumentError(
            "Can\u2019t provide both an `Authorization` header and a session cookie",
        );
    }

    // 1. Session cookie authentication
    if (sessionCookiePayload) {
        const sessionAccountId = await getSessionIfExists(context, sessionCookiePayload.sessionId);
        if (sessionAccountId === null) {
            // Remove our session cookie if the session was deleted from the database.
            sessionCookie!.dangerouslySet(null);
            return AnonymousActorContextModule.dangerouslyNew("AppClient");
        }

        if (sessionAccountId !== sessionCookiePayload.accountId) {
            throw new InternalError(
                "Session cookie `AccountId` doesn\u2019t match session `AccountId`",
            );
        }

        // If we receive a session cookie, we treat the request as if it came from a user's
        // web browser and use the `AppClient` service name.
        return SessionActorContextModule.dangerouslyNewWithoutCheckingIfRevoked(
            "AppClient",
            sessionCookiePayload.sessionId,
            sessionAccountId,
        );
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
            case "System": {
                return SystemActorContextModule.dangerouslyNew(
                    serviceName,
                    authorizationHeaderPayload.spaceId,
                );
            }
            case "ImpersonatedAccount": {
                const systemActorContextModule = SystemActorContextModule.dangerouslyNew(
                    serviceName,
                    authorizationHeaderPayload.spaceId,
                );
                return ImpersonatedAccountActorContextModule.dangerouslyNew(
                    systemActorContextModule,
                    authorizationHeaderPayload.accountId,
                );
            }
            case "Anonymous": {
                return AnonymousActorContextModule.dangerouslyNew(serviceName);
            }
            case "Bot": {
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

    // 3. If we don't have a session cookie or `Authorization` header then this is an
    //    anonymous request.
    return AnonymousActorContextModule.dangerouslyNew("AppClient");
}
