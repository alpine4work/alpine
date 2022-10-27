import {assert} from "~/shared/helpers/control/assert";
import {Id} from "~/shared/id/id";
import {Schema} from "~/shared/schema/schema";

/**
 * Cross-request state available synchronously on the client and server
 * identifying the user interacting with our product.
 *
 * The session is propagated through [HTTP cookies][1]. If a user clears their
 * cookies it will reset their session.
 *
 * [1]: https://en.wikipedia.org/wiki/HTTP_cookie
 */
export type Session = {
    /**
     * An `Id` representing the browser we are using to interact with the
     * product.
     *
     * Securely stored in our signed session cookie. You may use this `Id` if
     * you need a trusted identifier for the client.
     *
     * When we initialize the `browserId` in the session cookie we don't
     * reset it.
     */
    readonly browserId: Id;
};

/**
 * Get the session our code is running in. Throws if session context can't
 * be found.
 */
export function getSession(): Session {
    assert(
        (globalThis as any).__GET_SESSION__,
        "Could not find global implementation of `getSession()`",
    );
    return (globalThis as any).__GET_SESSION__();
}
