import {BrowserContext, test} from "@playwright/test";
import {ChildProcessByStdio, spawn} from "child_process";
import fs from "fs-extra";
import getPort from "get-port";
import {join as joinPath} from "path";
import {parse as parseSetCookieHeader} from "set-cookie-parser";
import {Readable} from "stream";
import {
    devAppServicePrivateKeyPath,
    devAppServicePublicKeyPath,
    devEdgeServiceFamilyPrivateKeyPath,
    devEdgeServiceFamilyPublicKeyPath,
    devJobQueueServicePrivateKeyPath,
    devJobQueueServicePublicKeyPath,
    devTaskRealtimeServicePrivateKeyPath,
    devTaskRealtimeServicePublicKeyPath,
    ensureDevServiceKeys,
} from "~/admin/helpers/dev_service_keys.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {TestContext, createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
import {getSessionCookieSetCookieHeaderForTest} from "~/server/tokens/session_cookie.js";
import {AppServiceTokenAgentPrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";

// This file can only run in tests.
assert(process.env.NODE_ENV === "test");

const env = parseDotenv();

// Assign AWS env variables to `process.env` so
// `@aws-sdk/credential-provider-node` picks them up.
process.env.AWS_ACCESS_KEY_ID = env.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = env.AWS_SECRET_ACCESS_KEY;

export type TestServices = {
    /**
     * The base URL for our server.
     */
    getBaseUrl(): string;

    /**
     * Sign a session in to the test browser context by setting the
     * appropriate cookies.
     */
    signIn(
        browserContext: BrowserContext,
        session:
            | {sessionId: SessionId; accountId: AccountId}
            | {id: SessionId; account: {id: AccountId}},
    ): Promise<void>;

    /**
     * Get the one time passwords generated during the current test. The array
     * resets after each test.
     */
    getOneTimePasswords(): ReadonlyArray<{emailAddress: string; oneTimePassword: string}>;
};

/**
 * Runs a test server for Playwright tests using the test context's DynamoDB. Also sets that server as the base URL for future tests.
 */
export function createTestServices(): {context: TestContext; services: TestServices} {
    // Important that this comes before `createTestContext()`! We want all our
    // services to finish shutting down before we kill the database services we start
    // in `createTestContext()`.
    //
    // For instance, the job queue needs to finish processing its jobs before we
    // can kill OpenSearch.
    test.afterAll(async () => {
        appServiceSubprocess?.kill("SIGINT");
        edgeServiceSubprocess?.kill("SIGINT");
        taskRealtimeServiceSubprocess?.kill("SIGINT");
        jobQueueServiceSubprocess?.kill("SIGINT");

        await runAllPromises([
            appServiceSubprocess && waitForProcessExit(appServiceSubprocess),
            edgeServiceSubprocess && waitForProcessExit(edgeServiceSubprocess),
            taskRealtimeServiceSubprocess && waitForProcessExit(taskRealtimeServiceSubprocess),
            jobQueueServiceSubprocess && waitForProcessExit(jobQueueServiceSubprocess),
        ]);
    });

    const context = createTestContext({
        shouldStartOpensearch: true,
        shouldSendJobsToSqs: true,
    });

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
    let taskRealtimeServiceSubprocess: ChildProcessByStdio<null, Readable, Readable> | undefined;
    let jobQueueServiceSubprocess: ChildProcessByStdio<null, Readable, Readable> | undefined;

    const appServiceTokenAgentPrivateSidePromise = (async () => {
        return AppServiceTokenAgentPrivateSide.new({
            serviceName: "AppService",
            servicePrivateKey: await fs.readFile(devAppServicePrivateKeyPath, "utf8"),
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
                `--jobQueueServicePublicKey=${devJobQueueServicePublicKeyPath}`,
                `--servicePrivateKey=${devAppServicePrivateKeyPath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--opensearchLocalPort=${context.getOpensearchLocalPort()}`,
                `--jobQueueUrl=${context.getSqsLocalJobQueueUrl()}`,
                `--allMiniLmL6V2LanguageModel=${joinPath(runfilesPath, "all_mini_lm_l6_v2")}`,
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
                `--jobQueueServicePublicKey=${devJobQueueServicePublicKeyPath}`,
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

        taskRealtimeServiceSubprocess = spawn(
            joinPath(runfilesPath, "cyberworlds/server/tasks/realtime/realtime.sh"),
            [
                `--portBase=${taskRealtimeServicePort}`,
                `--appServicePublicKey=${devAppServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${devTaskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${devJobQueueServicePublicKeyPath}`,
                `--servicePrivateKey=${devTaskRealtimeServicePrivateKeyPath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--opensearchLocalPort=${context.getOpensearchLocalPort()}`,
                `--jobQueueUrl=${context.getSqsLocalJobQueueUrl()}`,
                `--edgeServiceUrl=http://localhost:${edgeServicePort}`,
            ],
            {
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        // For whatever reason, `inherit` doesn't seem to work in Playwright? Manually
        // write data to stdout/stderr.
        taskRealtimeServiceSubprocess.stdout.on("data", chunk => process.stdout.write(chunk));
        taskRealtimeServiceSubprocess.stderr.on("data", chunk => process.stderr.write(chunk));

        jobQueueServiceSubprocess = spawn(
            joinPath(runfilesPath, "cyberworlds/server/jobs/queue/queue.sh"),
            [
                `--taskRealtimeServiceLocalPort=${taskRealtimeServicePort}`,
                `--appServicePublicKey=${devAppServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${devTaskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${devJobQueueServicePublicKeyPath}`,
                `--servicePrivateKey=${devJobQueueServicePrivateKeyPath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--opensearchLocalPort=${context.getOpensearchLocalPort()}`,
                `--jobQueueUrl=${context.getSqsLocalJobQueueUrl()}`,
                `--edgeServiceUrl=http://localhost:${edgeServicePort}`,
                `--allMiniLmL6V2LanguageModel=${joinPath(runfilesPath, "all_mini_lm_l6_v2")}`,
                `--apnsCertificate=${joinPath(
                    runfilesPath,
                    "cyberworlds/server/apns/certificates/apns_development_certificate.pem",
                )}`,
                `--apnsCertificatePrivateKey=${joinPath(
                    runfilesPath,
                    "cyberworlds/server/apns/certificates/apns_development_certificate_private_key.pem",
                )}`,
            ],
            {
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        // For whatever reason, `inherit` doesn't seem to work in Playwright? Manually
        // write data to stdout/stderr.
        jobQueueServiceSubprocess.stdout.on("data", chunk => process.stdout.write(chunk));
        jobQueueServiceSubprocess.stderr.on("data", chunk => process.stderr.write(chunk));

        await runAllPromises([
            waitForProcessSpawn(appServiceSubprocess),
            waitForProcessSpawn(edgeServiceSubprocess),
            waitForProcessSpawn(taskRealtimeServiceSubprocess),
            waitForProcessSpawn(jobQueueServiceSubprocess),
        ]);

        await runAllPromises([
            waitForHttpServer(appServicePort),
            waitForHttpServer(taskRealtimeServicePort),
        ]);

        // Wait for `appPort` to be ready before testing `edgePort`. Since testing
        // `edgePort` will forward the request to `appPort` since the edge service
        // proxies our app service.
        await waitForHttpServer(edgeServicePort);
    });

    const signIn = async (
        browserContext: BrowserContext,
        session:
            | {sessionId: SessionId; accountId: AccountId}
            | {id: SessionId; account: {id: AccountId}},
    ) => {
        const tokenAgentPrivateSide = await appServiceTokenAgentPrivateSidePromise;

        const sessionCookieHeader = await getSessionCookieSetCookieHeaderForTest(
            tokenAgentPrivateSide,
            {
                type: "Session",
                sessionId: "id" in session ? session.id : session.sessionId,
                accountId: "account" in session ? session.account.id : session.accountId,
            },
        );

        await browserContext.addCookies(
            parseSetCookieHeader(sessionCookieHeader).map(cookie => ({
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
        context,
        services: {
            getBaseUrl: () => {
                if (edgeServicePort === null)
                    throw new InternalError("Test server has not yet initialized");
                return `http://localhost:${edgeServicePort}`;
            },
            signIn,
            getOneTimePasswords: () => oneTimePasswords.slice(),
        },
    };
}
