import {SessionCookie} from "~/server/session/session_cookie";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {Id} from "~/shared/id/id";

export class SessionCookieContextModule extends ContextModuleBase {
    constructor(private readonly _sessionCookiePromise: Promise<SessionCookie>) {
        super();
    }

    public async get() {
        const sessionCookie = await this._sessionCookiePromise;
        return sessionCookie.get();
    }

    /**
     * Set the current session id in the cookie. This is dangerous because it
     * grants the browser the ability to act as the account associated with the
     * session! If you didn't appropriately authenticate the account then an
     * attacker will have access to that account.
     */
    public async dangerouslySetSessionId(sessionId: Id) {
        const sessionCookie = await this._sessionCookiePromise;
        sessionCookie.dangerouslySetSessionId(sessionId);
    }

    /**
     * Unset the session id. This signs the current account out.
     */
    public async unsetSessionId() {
        const sessionCookie = await this._sessionCookiePromise;
        sessionCookie.unsetSessionId();
    }
}
