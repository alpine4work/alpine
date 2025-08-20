import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {getSessionCookieIfExists} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";

// This file is used both by `EdgeService` and in tests. So we don't want to
// depend on anything `EdgeService` specific here.
export async function authorizeRequestAndGetSessionToken(
    tokenAgent: TokenAgent,
    request: Request,
): Promise<SessionTokenPayload> {
    const sessionCookieToken = await getSessionCookieIfExists(tokenAgent, request);
    if (!sessionCookieToken) throw unauthenticatedSessionError();

    return sessionCookieToken;
}
