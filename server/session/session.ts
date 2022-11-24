import {Session as CookieSession, createCookieSessionStorage} from "@remix-run/cloudflare";
import {cookieSessionSecret} from "~/server/env/env_variables";
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
export type SessionData = SchemaType<typeof SessionDataSchema>;

const SessionDataSchema = Schema.object({
    browserId: Schema.id,
    sessionId: Schema.id.nullable(),
});

function getDefaultSessionData(): SessionData {
    return {
        browserId: generateId(),
        sessionId: null,
    };
}

export class Session {
    /**
     * Create our session object from the provided request.
     */
    public static async new(request: Request) {
        const cookieHeader = request.headers.get("Cookie");
        const cookieSession = await cookieSessionStorage.getSession(cookieHeader);

        if (Object.keys(cookieSession.data).length !== 0) {
            const sessionData = SessionDataSchema.deserialize(cookieSession.data);
            return new Session(cookieSession, sessionData, false);
        }

        const sessionData = getDefaultSessionData();
        return new Session(cookieSession, sessionData, true);
    }

    private constructor(
        private readonly _cookieSession: CookieSession,
        private _data: SessionData,
        private _hasChanged: boolean,
    ) {}

    /**
     * Get the current data in the session.
     */
    public get(): SessionData {
        return this._data;
    }

    /**
     * Update the session with new data.
     *
     * This will not actually update the session cookie in the user's browser! You
     * need to call `commit()` on a response to save the new data in a user's
     * browser.
     */
    public set(data: SessionData) {
        this._data = data;
        this._hasChanged = true;
    }

    /**
     * Save the new session cookie in a user's browser if the session has changed.
     * If the session has not changed then do nothing.
     */
    public async commit(response: Response) {
        if (!this._hasChanged) return;

        const data = SessionDataSchema.serialize(this._data);

        // Unset all previous data then set our new data. This should fully replace the
        // Remix cookie data with our new cookie data.
        for (const key of Object.keys(this._cookieSession.data)) this._cookieSession.unset(key);
        for (const [key, value] of Object.entries(data)) this._cookieSession.set(key, value);

        response.headers.set(
            "Set-Cookie",
            await cookieSessionStorage.commitSession(this._cookieSession),
        );
    }
}
