import {
    Session as RawSession,
    SessionStorage,
    createCookieSessionStorage,
} from "@remix-run/cloudflare";
import {assert} from "~/shared/helpers/control/assert";
import {generateId} from "~/shared/id/id";
import {AccountId, BrowserId, SessionId} from "~/shared/id/types/id_types";
import {Schema, SchemaType} from "~/shared/schema/schema";

/**
 * Session information written to a browser cookie.
 *
 * Implemented using a signed session cookie.
 *
 * [1]: https://www.npmjs.com/package/cookie-session
 */
export type SessionCookieData = SchemaType<typeof SessionCookieDataSchema>;

const SessionCookieDataSchema = Schema.object({
    browserId: Schema.id<BrowserId>(),
    sessionId: Schema.id<SessionId>().nullable(),
    // Optimization: Include the session's account ID directly in our cookie so
    // that we can read the account's data along with the session's data in
    // parallel.
    sessionAccountId: Schema.id<AccountId>().optional(),
});

function getDefaultSessionCookieData(): SessionCookieData {
    return {
        browserId: generateId(),
        sessionId: null,
    };
}

// We use symbols for protected methods we want to call in a different class.
// Only files in this module have access to the symbol.
const newMethod = Symbol("new");
const commitMethod = Symbol("commit");

/**
 * Manages the storage of the session cookie on HTTP requests.
 */
export class SessionCookieStorage {
    private readonly _storage: SessionStorage;

    constructor({domain, secret}: {domain: string | null; secret: string}) {
        this._storage = createCookieSessionStorage({
            cookie: {
                name: "session",
                domain: domain ?? undefined,
                httpOnly: true,
                maxAge: 60 * 60 * 24 * 365, // 1 year
                path: "/",
                sameSite: "lax",
                secrets: [secret],
                // Only allow the session cookie to be sent over HTTPS in production. In
                // development we use plain HTTP.
                secure: process.env.NODE_ENV === "production",
            },
        });
    }

    /**
     * Create our session cookie from the request and commit our session cookie
     * back to the response with any changes made during the request.
     */
    public async with(
        request: Request,
        action: (sessionCookiePromise: Promise<SessionCookie>) => Promise<Response>,
    ): Promise<Response> {
        const sessionCookiePromise = SessionCookie[newMethod](this._storage, request);

        const response = await action(sessionCookiePromise);

        const sessionCookie = await sessionCookiePromise;
        await sessionCookie[commitMethod](this._storage, response);

        return response;
    }

    /**
     * Get the session cookie data without writing any updates on an outgoing
     * response.
     */
    public async get(request: Request): Promise<SessionCookieData> {
        const sessionCookie = await SessionCookie[newMethod](this._storage, request);
        return sessionCookie.get();
    }

    /**
     * Get the cookie header for a browser with just a session cookie corresponding
     * to the provided ids. Can only be run in test environments. This would be
     * dangerous to run outside of a test environment.
     */
    public async getCookieHeaderForTest(
        sessionId: SessionId,
        sessionAccountId: AccountId,
    ): Promise<string> {
        assert(process.env.NODE_ENV === "test");

        const data = SessionCookieDataSchema.serialize({
            ...getDefaultSessionCookieData(),
            sessionId,
            sessionAccountId,
        });

        const rawSession = await this._storage.getSession();
        for (const [key, value] of Object.entries(data)) rawSession.set(key, value);

        return this._storage.commitSession(rawSession);
    }
}

/**
 * Helper class for dealing with the information we save in a signed
 * browser cookie.
 */
export class SessionCookie {
    private _hasCommitted = false;

    private constructor(
        private readonly _session: RawSession,
        private _data: SessionCookieData,
        private _hasChanged: boolean,
    ) {}

    public static async [newMethod](storage: SessionStorage, request: Request) {
        const cookieHeader = request.headers.get("cookie");
        const session = await storage.getSession(cookieHeader);

        if (Object.keys(session.data).length !== 0) {
            const data = SessionCookieDataSchema.deserialize(session.data);
            return new SessionCookie(session, data, false);
        }

        const data = getDefaultSessionCookieData();
        return new SessionCookie(session, data, true);
    }

    /**
     * Get the current data in the session.
     */
    public get(): SessionCookieData {
        return this._data;
    }

    /**
     * Set the current session id in the cookie. This is dangerous because it
     * grants the browser the ability to act as the account associated with the
     * session! If you didn't appropriately authenticate the account then an
     * attacker will have access to that account.
     */
    public dangerouslySetSessionId(sessionId: SessionId, sessionAccountId: AccountId) {
        this._dangerouslyUpdate(data => ({
            ...data,
            sessionId,
            sessionAccountId,
        }));
    }

    /**
     * Unset the session id. This signs the current account out.
     */
    public unsetSessionId() {
        this._dangerouslyUpdate(data => ({
            ...data,
            sessionId: null,
            sessionAccountId: undefined,
        }));
    }

    private _dangerouslyUpdate(updater: (data: SessionCookieData) => SessionCookieData) {
        this._dangerouslySet(updater(this.get()));
    }

    /**
     * Update the session with new data.
     *
     * This will not actually update the session cookie in the user's browser! You
     * need to call `commit()` on a response to save the new data in a user's
     * browser.
     *
     * This method is dangerous since it allows you to change the account that's
     * identified with our service! You must take care to authenticate accounts
     * before changing the session id.
     */
    private _dangerouslySet(data: SessionCookieData) {
        assert(!this._hasCommitted, "Session cookie has already committed");
        this._data = data;
        this._hasChanged = true;
    }

    /**
     * Save the new session cookie in a user's browser if the session has changed.
     * If the session has not changed then do nothing.
     */
    public async [commitMethod](storage: SessionStorage, response: Response) {
        if (!this._hasChanged) return;

        const data = SessionCookieDataSchema.serialize(this._data);

        // Unset all previous data then set our new data. This should fully replace the
        // Remix cookie data with our new cookie data.
        for (const key of Object.keys(this._session.data)) this._session.unset(key);
        for (const [key, value] of Object.entries(data)) this._session.set(key, value);

        const setCookieHeader = await storage.commitSession(this._session);
        response.headers.set("set-cookie", setCookieHeader);

        // Can not update the session cookie after it has committed.
        this._hasCommitted = true;
    }
}
