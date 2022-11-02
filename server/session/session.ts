import {createCookieSessionStorage} from "@remix-run/cloudflare";
import {cookieSessionSecret} from "~/server/env/env-variables";
import {generateId} from "~/shared/id/id";
import {Schema, SchemaType} from "~/shared/schema/schema";

const cookieSessionStorage = createCookieSessionStorage({
    cookie: {
        name: "session",
        // TODO(calebmer): This should probably be an environment variable.
        domain: "localhost",
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 365, // 1 year
        path: "/",
        sameSite: "lax",
        secrets: [cookieSessionSecret],
        secure: true,
    },
});

/**
 * Session information written to a browser cookie.
 *
 * Implemented using a signed session cookie.
 *
 * [1]: https://www.npmjs.com/package/cookie-session
 */
export type Session = SchemaType<typeof SessionSchema>;

const SessionSchema = Schema.object({
    browserId: Schema.id,
});

function getDefaultSession(): Session {
    return {
        browserId: generateId(),
    };
}

/**
 * Gets the session object for the request from a cookie on the request. If the
 * session cookie has not been set, we initialize a default session.
 */
export async function getSession(request: Request): Promise<Session> {
    const cookieHeader = request.headers.get("Cookie");
    const rawSession = await cookieSessionStorage.getSession(cookieHeader);

    if (Object.keys(rawSession.data).length === 0) {
        return getDefaultSession();
    }

    return SessionSchema.deserialize(rawSession.data);
}

/**
 * Creates a new `Set-Cookie` header string for committing our session back to
 * the browser.
 */
// TODO(calebmer): This is a little more inconvenient given we want to
// implicitly set a `browserId` on every request. Reconsider this design. If
// Remix has middleware can we put something there?
export async function commitSession(request: Request, session: Session): Promise<string> {
    const cookieHeader = request.headers.get("Cookie");
    const rawSession = await cookieSessionStorage.getSession(cookieHeader);

    for (const key of Object.keys(rawSession.data)) delete rawSession.data[key];

    SessionSchema.serializeInto(session, rawSession.data);

    return cookieSessionStorage.commitSession(rawSession);
}
