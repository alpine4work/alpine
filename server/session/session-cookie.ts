import createCookieSessionMiddleware from "cookie-session";
import {IncomingMessage, ServerResponse} from "http";
import {assert} from "~/shared/helpers/control/assert";
import {generateId} from "~/shared/id/id";
import {Schema, SchemaType} from "~/shared/schema/schema";

/**
 * Session information written to a browser cookie.
 *
 * Implemented using [`cookie-session`][1].
 *
 * [1]: https://www.npmjs.com/package/cookie-session
 */
export type SessionCookie = SchemaType<typeof SessionCookieSchema>;

const SessionCookieSchema = Schema.object({
    browserId: Schema.id,
});

assert(process.env.SESSION_SECRET);

const cookieSessionMiddleware = createCookieSessionMiddleware({
    name: "session",
    secret: process.env.SESSION_SECRET,
    signed: true,
    httpOnly: true,
    sameSite: true,
    maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year
});

const hasRunCookieSessionMiddlewareSymbol = Symbol("hasRunCookieSessionMiddleware");

async function runCookieSessionMiddleware(
    req: IncomingMessage & {[hasRunCookieSessionMiddlewareSymbol]?: boolean},
    res: ServerResponse,
): Promise<void> {
    if (req[hasRunCookieSessionMiddlewareSymbol]) return;
    req[hasRunCookieSessionMiddlewareSymbol] = true;

    await new Promise<void>((resolve, reject) => {
        cookieSessionMiddleware(req as any, res as any, error => {
            if (error) reject(error);
            else resolve();
        });
    });
}

/**
 * Sets the session cookie on the request.
 */
export async function setSessionCookie(
    context: {req: IncomingMessage; res: ServerResponse},
    sessionCookie: SessionCookie,
): Promise<void> {
    await runCookieSessionMiddleware(context.req, context.res);

    (context.req as any).session = SessionCookieSchema.serialize(sessionCookie);
}

function getDefaultSessionCookie(): SessionCookie {
    return {
        browserId: generateId(),
    };
}

/**
 * Gets the session cookie for the request. If the session cookie has not been
 * set, we initialize a default session cookie.
 */
export async function getSessionCookie(context: {
    req: IncomingMessage;
    res: ServerResponse;
}): Promise<SessionCookie> {
    await runCookieSessionMiddleware(context.req, context.res);

    if (!(context.req as any).session.isPopulated) {
        (context.req as any).session = getDefaultSessionCookie();
    }

    return SessionCookieSchema.deserialize((context.req as any).session);
}
