import {parse, serialize} from "cookie";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {TokenAgentAppServicePrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";

/**
 * Get and verify the `SessionTokenPayload` in the requests session cookie if it
 * exists. Otherwise return null.
 */
export async function getSessionCookieIfExists({
    tokenAgent,
    cookieNameSuffix,
    request,
}: {
    tokenAgent: TokenAgent;
    cookieNameSuffix: string;
    request: Request;
}): Promise<SessionTokenPayload | null> {
    const cookieHeader = request.headers.get("cookie");
    if (!cookieHeader) return null;

    const token = parse(cookieHeader)[`session${cookieNameSuffix}`];
    if (!token) return null;

    // We delete our session cookie by setting it to an empty string.
    if (token === "") return null;

    // NOTE(calebmer, 2023-06-29): I'm changing our session cookie format to a JWT.
    // Since we're in alpha I'm removing support for the old session cookie format
    // which used Remix's `createCookieSessionStorage()` utility. When deployed, this
    // will sign all users out. They can sign back in as necessary.
    //
    // The old cookie format was a signed base64 JSON string. It had two parts. The
    // base64 JSON string part and the signature separated by a `.`. The new cookie
    // format is a JWT. JWTs have three parts. The header, base 64 JSON, and signature.
    if (token.split(".").length === 2) return null;

    const payload = await tokenAgent.publicSide.verifyTokenFromService("AppService", token);

    if (payload.type !== "Session")
        throw new PermissionDeniedError("Unexpected token payload type in session cookie");

    return payload;
}

export type SessionCookie = {
    readonly getIfExists: () => Promise<SessionTokenPayload | null>;

    /**
     * Update the session with new data.
     *
     * This method is dangerous since it allows you to change the account that's
     * identified with our service! You must take care to authenticate accounts before
     * changing the `SessionId`.
     */
    readonly dangerouslySet: (token: SessionTokenPayload | null) => void;
};

/**
 * Use this to both read the session cookie and write back to the session cookie.
 * If you only need to read the session cookie then use
 * `getSessionCookieIfExists()`.
 */
export async function withSessionCookie(
    options: {
        tokenAgent: TokenAgent<TokenAgentAppServicePrivateSide>;
        cookieNameSuffix: string;
        request: Request;
    },
    action: (sessionCookie: SessionCookie) => Promise<Response>,
): Promise<Response> {
    const oldTokenPromise = getSessionCookieIfExists(options);
    let canSetToken = true;
    let newToken: SessionTokenPayload | null | "Unset" = "Unset";

    const response = await action({
        getIfExists: () => {
            return newToken === "Unset" ? oldTokenPromise : Promise.resolve(newToken);
        },
        dangerouslySet: token => {
            assert(canSetToken);
            newToken = token;
        },
    });

    // We are now committing the new session token. It may not be updated again.
    canSetToken = false;

    const oldSessionTokenPayload = await oldTokenPromise;

    if (newToken !== "Unset" && oldSessionTokenPayload !== newToken) {
        const header = await getSessionCookieSetCookieHeader(
            options.tokenAgent.privateSide,
            options.cookieNameSuffix,
            newToken,
        );
        response.headers.append("set-cookie", header);
    }

    return response;
}

async function getSessionCookieSetCookieHeader(
    tokenAgentPrivateSide: TokenAgentAppServicePrivateSide,
    cookieNameSuffix: string,
    token: SessionTokenPayload | null,
) {
    const cookieString = token
        ? await tokenAgentPrivateSide.dangerouslySignEternalSessionToken(token)
        : "";

    // If you update the cookie configuration here, you also need to update where we
    // set the cookie in our native mobile apps. For iOS we currently construct the
    // cookie in the file `RootTabBarController.swift`.
    return serialize(`session${cookieNameSuffix}`, cookieString, {
        // The session cookie domain is not set in development because we may be accessing
        // from a proxied domain or an IP address on a mobile device.
        domain: process.env.NODE_ENV === "production" ? "alpine.inc" : undefined,
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        // Only allow the session cookie to be sent over HTTPS in production. In
        // development we use plain HTTP.
        secure: process.env.NODE_ENV === "production",
        // We can't force the browser to delete a cookie so we set it to an empty string
        // and tell the browser to expire it immediately.
        maxAge: token
            ? 60 * 60 * 24 * 365 // 1 year
            : 1, // 1 second
    });
}

// Let tests call this function directly.
export function getSessionCookieSetCookieHeaderForTest(
    tokenAgentPrivateSide: TokenAgentAppServicePrivateSide,
    cookieNameSuffix: string,
    token: SessionTokenPayload | null,
) {
    assert(isTestNodeEnvOrAdminScenariosScript);
    return getSessionCookieSetCookieHeader(tokenAgentPrivateSide, cookieNameSuffix, token);
}
