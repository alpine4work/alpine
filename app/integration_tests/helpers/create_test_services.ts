import {BrowserContext, test} from "@playwright/test";
import {ChildProcessByStdio, spawn} from "child_process";
import fs from "fs-extra";
import getPort from "get-port";
import {join as joinPath} from "path";
import {parse as parseSetCookie} from "set-cookie-parser";
import {Readable} from "stream";
import {
    devAppServicePrivateKeyPath,
    devAppServicePublicKeyPath,
    devEdgeServiceFamilyPrivateKeyPath,
    devEdgeServiceFamilyPublicKeyPath,
    ensureDevServiceKeys,
} from "~/admin/helpers/dev_service_keys.js";
import {runfilesPath} from "~/admin/helpers/runfiles_path.js";
import {waitForHttpServer} from "~/server/helpers/wait_for_http_server.js";
import {waitForProcessExit} from "~/admin/helpers/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/admin/helpers/wait_for_process_spawn.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSession} from "~/server/dynamo/test_helpers/create_test_session.js";
import {getSessionCookieSetCookieHeaderForTest} from "~/server/tokens/session_cookie.js";
import {AppServiceTokenAgent} from "~/server/tokens/token_agent.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

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

    /**
     * Get the one time passwords generated during the current test. The array
     * resets after each test.
     */
    getOneTimePasswords(): ReadonlyArray<{emailAddress: string; oneTimePassword: string}>;
};

/**
 * Runs a test server for Playwright tests using the test context's DynamoDB. Also sets that server as the base URL for future tests.
 */
export function createTestServices(context: TestContext): TestServer {
    const edgePortPromise = getPort();
    let edgePort: number | null = null;
    void edgePortPromise.then(port => (edgePort = port));

    test.use({
        baseURL: async ({}, use) => {
            const edgePort = await edgePortPromise;
            await use(`http://localhost:${edgePort}`);
        },
    });

    let appSubprocess: ChildProcessByStdio<null, Readable, Readable> | undefined;
    let edgeSubprocess: ChildProcessByStdio<null, Readable, Readable> | undefined;

    const appServiceTokenAgentPromise = (async () => {
        const [appServicePublicKey, edgeServiceFamilyPublicKey, appServicePrivateKey] =
            await runAllPromises([
                fs.readFile(devAppServicePublicKeyPath, "utf8"),
                fs.readFile(devEdgeServiceFamilyPublicKeyPath, "utf8"),
                fs.readFile(devAppServicePrivateKeyPath, "utf8"),
            ]);

        return AppServiceTokenAgent.new({
            appServicePublicKey,
            edgeServiceFamilyPublicKey,
            appServicePrivateKey,
        });
    })();

    let oneTimePasswords: Array<{emailAddress: string; oneTimePassword: string}> = [];

    test.beforeEach(() => {
        // Clear out one time passwords before the next test.
        oneTimePasswords = [];
    });

    test.beforeAll(async () => {
        const [edgePort, appPort] = await runAllPromises([
            edgePortPromise,
            getPort(),
            ensureDevServiceKeys(),
        ]);

        appSubprocess = spawn(
            joinPath(runfilesPath, "cyberworlds/app/app.sh"),
            [
                `--port=${appPort}`,
                `--edgeServiceUrl=http://localhost:${edgePort}`,
                `--appServicePublicKey=${devAppServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
                `--appServicePrivateKey=${devAppServicePrivateKeyPath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
            ],
            {
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        // For whatever reason, `inherit` doesn't seem to work in Playwright? Manually
        // write data to stdout/stderr.
        appSubprocess.stdout.on("data", chunk => {
            const chunkString = chunk.toString();

            const oneTimePasswordMatch = chunkString.match(
                /The one time password for "([^"]+)" is "([^"]+)"/,
            );
            if (oneTimePasswordMatch) {
                oneTimePasswords.push({
                    emailAddress: oneTimePasswordMatch[1],
                    oneTimePassword: oneTimePasswordMatch[2],
                });
            }

            process.stdout.write(chunkString);
        });

        appSubprocess.stderr.on("data", chunk => process.stderr.write(chunk));

        edgeSubprocess = spawn(
            joinPath(runfilesPath, "cyberworlds/server/edge/edge.sh"),
            [
                `--port=${edgePort}`,
                `--appServiceUrl=http://localhost:${appPort}`,
                `--appServicePublicKey=${devAppServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
                `--edgeServiceFamilyPrivateKey=${devEdgeServiceFamilyPrivateKeyPath}`,
            ],
            {
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        // For whatever reason, `inherit` doesn't seem to work in Playwright? Manually
        // write data to stdout/stderr.
        edgeSubprocess.stdout.on("data", chunk => process.stdout.write(chunk));
        edgeSubprocess.stderr.on("data", chunk => process.stderr.write(chunk));

        await runAllPromises([
            waitForProcessSpawn(appSubprocess),
            waitForProcessSpawn(edgeSubprocess),
        ]);

        await waitForHttpServer(`http://localhost:${appPort}`);

        // Wait for `appPort` to be ready before testing `edgePort`. Since testing
        // `edgePort` will forward the request to `appPort` since the edge service
        // proxies our app service.
        await waitForHttpServer(`http://localhost:${edgePort}`);
    });

    test.afterAll(async () => {
        appSubprocess?.kill("SIGINT");
        edgeSubprocess?.kill("SIGINT");

        await runAllPromises([
            appSubprocess && waitForProcessExit(appSubprocess),
            edgeSubprocess && waitForProcessExit(edgeSubprocess),
        ]);
    });

    const signIn = async (browserContext: BrowserContext, session: TestSession) => {
        const tokenAgent = await appServiceTokenAgentPromise;

        const sessionCookieHeader = await getSessionCookieSetCookieHeaderForTest(tokenAgent, {
            type: "Session",
            sessionId: session.id,
            accountId: session.accountId,
        });

        await browserContext.addCookies(
            parseSetCookie(sessionCookieHeader).map(cookie => ({
                // Playwright requires a `domain`/`path` pair but outside of production our
                // cookie only has a `path`.
                domain: "localhost",
                ...cookie,
                // Transform the result from our parser to what Playwright expects.
                expires: cookie.maxAge
                    ? Math.round(Date.now() / 1000) + cookie.maxAge
                    : cookie.expires
                    ? Math.round(cookie.expires.getTime() / 1000)
                    : undefined,
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
            if (edgePort === null) throw new InternalError("Test server has not yet initialized");
            return `http://localhost:${edgePort}`;
        },
        signIn,
        getOneTimePasswords: () => oneTimePasswords.slice(),
    };
}
