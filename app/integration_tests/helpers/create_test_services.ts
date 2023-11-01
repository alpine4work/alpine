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
    devTaskRealtimeServicePublicKeyPath,
    ensureDevServiceKeys,
} from "~/admin/helpers/dev_service_keys.js";
import {runfilesPath} from "~/admin/helpers/runfiles_path.js";
import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSessionItem} from "~/server/dynamo/test_helpers/create_test_session.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
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
    signIn(browserContext: BrowserContext, session: TestSessionItem): Promise<void>;

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
    const edgeServicePortPromise = getPort();
    let edgeServicePort: number | null = null;
    void edgeServicePortPromise.then(port => (edgeServicePort = port));

    test.use({
        baseURL: async ({}, use) => {
            const edgeServicePort = await edgeServicePortPromise;
            await use(`http://localhost:${edgeServicePort}`);
        },
    });

    let appServiceSubprocess: ChildProcessByStdio<null, Readable, Readable> | undefined;
    let edgeServiceSubprocess: ChildProcessByStdio<null, Readable, Readable> | undefined;

    const appServiceTokenAgentPromise = (async () => {
        const [
            appServicePublicKey,
            edgeServiceFamilyPublicKey,
            taskRealtimeServicePublicKey,
            appServicePrivateKey,
        ] = await runAllPromises([
            fs.readFile(devAppServicePublicKeyPath, "utf8"),
            fs.readFile(devEdgeServiceFamilyPublicKeyPath, "utf8"),
            fs.readFile(devTaskRealtimeServicePublicKeyPath, "utf8"),
            fs.readFile(devAppServicePrivateKeyPath, "utf8"),
        ]);

        return AppServiceTokenAgent.new({
            appServicePublicKey,
            edgeServiceFamilyPublicKey,
            taskRealtimeServicePublicKey,
            appServicePrivateKey,
        });
    })();

    let oneTimePasswords: Array<{emailAddress: string; oneTimePassword: string}> = [];

    test.beforeEach(() => {
        // Clear out one time passwords before the next test.
        oneTimePasswords = [];
    });

    test.beforeAll(async () => {
        const [edgeServicePort, taskRealtimeServicePort, appServicePort] = await runAllPromises([
            edgeServicePortPromise,
            getPort(),
            getPort(),
            ensureDevServiceKeys(),
        ]);

        appServiceSubprocess = spawn(
            joinPath(runfilesPath, "cyberworlds/app/app.sh"),
            [
                `--port=${appServicePort}`,
                `--edgeServiceUrl=http://localhost:${edgeServicePort}`,
                `--taskRealtimeServiceLocalPort=${taskRealtimeServicePort}`,
                `--appServicePublicKey=${devAppServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${devTaskRealtimeServicePublicKeyPath}`,
                `--appServicePrivateKey=${devAppServicePrivateKeyPath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--opensearchLocalPort=${context.getOpensearchLocalPort()}`,
            ],
            {
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        // For whatever reason, `inherit` doesn't seem to work in Playwright? Manually
        // write data to stdout/stderr.
        appServiceSubprocess.stdout.on("data", chunk => {
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

        appServiceSubprocess.stderr.on("data", chunk => process.stderr.write(chunk));

        edgeServiceSubprocess = spawn(
            joinPath(runfilesPath, "cyberworlds/server/edge/edge.sh"),
            [
                `--port=${edgeServicePort}`,
                `--appServiceUrl=http://localhost:${appServicePort}`,
                `--appServicePublicKey=${devAppServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${devTaskRealtimeServicePublicKeyPath}`,
                `--edgeServiceFamilyPrivateKey=${devEdgeServiceFamilyPrivateKeyPath}`,
            ],
            {
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        // For whatever reason, `inherit` doesn't seem to work in Playwright? Manually
        // write data to stdout/stderr.
        edgeServiceSubprocess.stdout.on("data", chunk => process.stdout.write(chunk));
        edgeServiceSubprocess.stderr.on("data", chunk => process.stderr.write(chunk));

        await runAllPromises([
            waitForProcessSpawn(appServiceSubprocess),
            waitForProcessSpawn(edgeServiceSubprocess),
        ]);

        await waitForHttpServer(appServicePort);

        // Wait for `appPort` to be ready before testing `edgePort`. Since testing
        // `edgePort` will forward the request to `appPort` since the edge service
        // proxies our app service.
        await waitForHttpServer(edgeServicePort);
    });

    test.afterAll(async () => {
        appServiceSubprocess?.kill("SIGINT");
        edgeServiceSubprocess?.kill("SIGINT");

        await runAllPromises([
            appServiceSubprocess && waitForProcessExit(appServiceSubprocess),
            edgeServiceSubprocess && waitForProcessExit(edgeServiceSubprocess),
        ]);
    });

    const signIn = async (browserContext: BrowserContext, session: TestSessionItem) => {
        const tokenAgent = await appServiceTokenAgentPromise;

        const sessionCookieHeader = await getSessionCookieSetCookieHeaderForTest(tokenAgent, {
            type: "Session",
            sessionId: session.sessionId,
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
            if (edgeServicePort === null)
                throw new InternalError("Test server has not yet initialized");
            return `http://localhost:${edgeServicePort}`;
        },
        signIn,
        getOneTimePasswords: () => oneTimePasswords.slice(),
    };
}
