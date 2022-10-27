import {AsyncLocalStorage} from "async_hooks";
import {IncomingMessage, ServerResponse} from "http";
import {getSessionCookie} from "~/server/session/session-cookie";
import {assert} from "~/shared/helpers/control/assert";
import {Session} from "~/shared/session/session";

const sessionAsyncLocalStorage = new AsyncLocalStorage<Session>();

/**
 * Provide the session to deeply nested async function calls
 * through `AsyncLocalStorage`.
 */
export async function withSessionInAsyncLocalStorage<Value>(
    context: {
        req: IncomingMessage;
        res: ServerResponse;
    },
    action: (session: Session) => Promise<Value>,
) {
    const sessionCookie = await getSessionCookie(context);

    // Re-create `Session` from `SessionCookie` since `SessionCookie` may have
    // properties we don't want on the client.
    const session: Session = {
        browserId: sessionCookie.browserId,
    };

    return sessionAsyncLocalStorage.run(session, action, session);
}

/**
 * Get the session from anywhere within our `withSessionAsyncLocalStorage()`
 * call.
 */
export function getSessionFromAsyncLocalStorage(): Session {
    const session = sessionAsyncLocalStorage.getStore();
    assert(
        session,
        "Session not found in async local storage, did you wrap this function call in `withSessionAsyncLocalStorage()`?",
    );
    return session;
}

(globalThis as any).__GET_SESSION__ = getSessionFromAsyncLocalStorage;
