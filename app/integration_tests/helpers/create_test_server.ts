import {BrowserContext, test} from "@playwright/test";
import getPort from "get-port";
import {parse as parseSetCookie} from "set-cookie-parser";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {LocalServer, createLocalServer} from "~/app/local/create_local_server.js";
import {TestContext} from "~/server/dynamo/test_helpers/shared/create_test_context.js";
import {TestSession} from "~/server/dynamo/test_helpers/shared/create_test_session.js";
import {SessionCookieStorage} from "~/server/remix/session_cookie.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

// This file can only run in tests.
assert(process.env.NODE_ENV === "test");

export type TestServer = {
    /**
     * The base URL for our server.
     */
    getBaseUrl(): string;
    /**
     * Sign a session in to the test browser context by setting the
     * appropriate cookies.
     */
    signIn(browserContext: BrowserContext, session: TestSession): Promise<void>;
};

/**
 * Runs a test server for Playwright tests using the test context's DynamoDB. Also sets that server as the base URL for future tests.
 */
export function createTestServer(
    context: TestContext,
    {globals}: {globals?: {[key: string]: unknown}} = {},
): TestServer {
    const env = parseDotenv();
    let localServer: LocalServer | null = null;

    const portPromise = getPort();
    let port: number | null = null;
    void portPromise.then(_port => (port = _port));

    test.use({
        baseURL: async ({}, use) => {
            const port = await portPromise;
            await use(`http://localhost:${port}`);
        },
    });

    test.beforeAll(async () => {
        const port = await portPromise;

        const _localServer = createLocalServer({
            bindings: {
                NODE_ENV: "test",
                DYNAMO_LOCAL_PORT: context.getDynamoLocalPort(),
            },
            globals,
        });

        await new Promise<void>(resolve => {
            _localServer.server.listen(port, () => resolve());
        });

        localServer = _localServer;
    });

    test.afterAll(async () => {
        assert(localServer !== null);
        localServer.server.close();
        await localServer.miniflare.dispose();
    });

    const sessionCookieSecret = assertExists(env.SESSION_COOKIE_SECRET);

    const sessionCookieStorage = new SessionCookieStorage({
        domain: "localhost",
        secret: sessionCookieSecret,
    });

    const signIn = async (browserContext: BrowserContext, session: TestSession) => {
        const sessionCookieHeader = await sessionCookieStorage.getCookieHeaderForTest(
            session.id,
            session.accountId,
        );

        await browserContext.addCookies(
            parseSetCookie(sessionCookieHeader).map(cookie => ({
                ...cookie,
                // Transform the result from our parser to what Playwright expects.
                expires: cookie.expires ? Math.round(cookie.expires.getTime() / 1000) : undefined,
                sameSite: cookie.sameSite
                    ? ({strict: "Strict", lax: "Lax", none: "None"} as const)[
                          cookie.sameSite.toLowerCase()
                      ]
                    : undefined,
            })),
        );
    };

    return {
        getBaseUrl: () => {
            if (port === null) throw new InternalError("Test server has not yet initialized");
            return `http://localhost:${port}`;
        },
        signIn,
    };
}
