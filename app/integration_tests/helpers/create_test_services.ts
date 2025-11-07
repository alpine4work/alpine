import {BrowserContext, test} from "@playwright/test";
import {ChildProcessByStdio, spawn} from "child_process";
import fs from "fs-extra";
import getPort from "get-port";
import {join as joinPath} from "path";
import {parse as parseSetCookieHeader} from "set-cookie-parser";
import {Readable as ReadableStream} from "stream";
import {ensureServiceKeys} from "~/admin/helpers/ensure_service_keys.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestContext, createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {getSessionCookieSetCookieHeaderForTest} from "~/server/tokens/session_cookie.js";
import {TokenAgentAppServicePrivateSide} from "~/server/tokens/token_agent_private_side.js";
import {InternalError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
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
        // First wait for `JobQueueService` and `EdgeServiceFamily` to finish since
        // they may need to make requests to `AppService` while finishing up ingress
        // traffic.
        //
        // Catch any errors so we can still shutdown `AppService` even if the shutdown
        // of one of these processes fails.
        const result1 = await captureResultPromise(async () => {
            jobQueueServiceSubprocess?.kill("SIGINT");
            edgeServiceSubprocess?.kill("SIGINT");

            await runAllPromises([
                jobQueueServiceSubprocess && waitForProcessExit(jobQueueServiceSubprocess),
                edgeServiceSubprocess && waitForProcessExit(edgeServiceSubprocess),
            ]);
        });

        jobQueueServiceSubprocess = undefined;
        edgeServiceSubprocess = undefined;

        const result2 = await captureResultPromise(async () => {
            appServiceSubprocess?.kill("SIGINT");
            taskRealtimeServiceSubprocess?.kill("SIGINT");
            fileProcessorServiceSubprocess?.kill("SIGINT");

            await runAllPromises([
                appServiceSubprocess && waitForProcessExit(appServiceSubprocess),
                taskRealtimeServiceSubprocess && waitForProcessExit(taskRealtimeServiceSubprocess),
                fileProcessorServiceSubprocess &&
                    waitForProcessExit(fileProcessorServiceSubprocess),
            ]);
        });

        appServiceSubprocess = undefined;
        taskRealtimeServiceSubprocess = undefined;
        fileProcessorServiceSubprocess = undefined;

        unwrapResult(result1);
        unwrapResult(result2);
    });

    const context = createTestContext({
        shouldStartOpensearch: true,
        shouldSendJobsToSqs: true,
        chatInjection,
        documentsInjection,
        forumInjection,
        notificationsInjection,
        searchInjection,
        spacesInjection,
        tasksInjection,
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

    let appServiceTokenAgentPrivateSide: TokenAgentAppServicePrivateSide | undefined;

    let appServiceSubprocess: ChildProcessByStdio<null, ReadableStream, ReadableStream> | undefined;
    let edgeServiceSubprocess:
        | ChildProcessByStdio<null, ReadableStream, ReadableStream>
        | undefined;
    let taskRealtimeServiceSubprocess:
        | ChildProcessByStdio<null, ReadableStream, ReadableStream>
        | undefined;
    let jobQueueServiceSubprocess:
        | ChildProcessByStdio<null, ReadableStream, ReadableStream>
        | undefined;
    let fileProcessorServiceSubprocess:
        | ChildProcessByStdio<null, ReadableStream, ReadableStream>
        | undefined;

    let oneTimePasswords: Array<{emailAddress: string; oneTimePassword: string}> = [];

    test.beforeEach(() => {
        // Clear out one time passwords before the next test.
        oneTimePasswords = [];
    });

    test.beforeAll(async () => {
        const keysDirectoryPath = joinPath(context.getTemporaryDirectoryPath(), "keys");
        const ensureLocalCachePath = joinPath(context.getTemporaryDirectoryPath(), "ensure");
        const cloudflareR2LocalDataPath = joinPath(context.getTemporaryDirectoryPath(), "r2");
        const fileProcessorServiceTemporaryDirectoryPath = joinPath(
            context.getTemporaryDirectoryPath(),
            "files",
        );
        const edgeCacheLocalDataPath = joinPath(context.getTemporaryDirectoryPath(), "edge/cache");
        const edgeDurableObjectsLocalDataPath = joinPath(
            context.getTemporaryDirectoryPath(),
            "edge/durable-objects",
        );

        const appServicePrivateKeyPath = joinPath(keysDirectoryPath, "app_service_rsa");
        const appServicePublicKeyPath = joinPath(keysDirectoryPath, "app_service_rsa.pub");

        const edgeServiceFamilyPrivateKeyPath = joinPath(
            keysDirectoryPath,
            "edge_service_family_rsa",
        );
        const edgeServiceFamilyPublicKeyPath = joinPath(
            keysDirectoryPath,
            "edge_service_family_rsa.pub",
        );

        const taskRealtimeServicePrivateKeyPath = joinPath(
            keysDirectoryPath,
            "task_realtime_service_rsa",
        );
        const taskRealtimeServicePublicKeyPath = joinPath(
            keysDirectoryPath,
            "task_realtime_service_rsa.pub",
        );

        const jobQueueServicePrivateKeyPath = joinPath(keysDirectoryPath, "job_queue_service_rsa");
        const jobQueueServicePublicKeyPath = joinPath(
            keysDirectoryPath,
            "job_queue_service_rsa.pub",
        );

        const fileProcessorServicePrivateKeyPath = joinPath(
            keysDirectoryPath,
            "file_processor_service_rsa",
        );
        const fileProcessorServicePublicKeyPath = joinPath(
            keysDirectoryPath,
            "file_processor_service_rsa.pub",
        );

        const resourceServicePublicKeyPath = joinPath(
            keysDirectoryPath,
            "resource_service_rsa.pub",
        );

        const apiServicePublicKeyPath = joinPath(keysDirectoryPath, "api_service_rsa.pub");

        const tokenAgentSecretPath = joinPath(keysDirectoryPath, "token_agent_secret");

        const [
            edgeServicePort,
            taskRealtimeServicePort,
            appServicePort,
            fileProcessorServicePort,
            newAppServiceTokenAgentPrivateSide,
        ] = await runAllPromises([
            edgeServicePortPromise,
            getPort(),
            getPort(),
            getPort(),
            ensureServiceKeys(keysDirectoryPath).then(async () =>
                TokenAgentAppServicePrivateSide.new({
                    serviceName: "AppService",
                    servicePrivateKey: await fs.readFile(appServicePrivateKeyPath, "utf8"),
                    secret: await fs.readFile(tokenAgentSecretPath, "utf8"),
                }),
            ),
        ]);
        appServiceTokenAgentPrivateSide = newAppServiceTokenAgentPrivateSide;

        const allMiniLmL6V2LanguageModelPath = joinPath(runfilesPath, "all_mini_lm_l6_v2");

        const apnsCertificatePath = joinPath(
            runfilesPath,
            "cyberworlds/server/apns/certificates/apns_development_certificate.pem",
        );

        const apnsCertificatePrivateKeyPath = joinPath(
            runfilesPath,
            "cyberworlds/server/apns/certificates/apns_development_certificate_private_key.pem",
        );

        const resourceServiceUrl =
            env.RESOURCE_SERVICE_URL ?? `http://localhost:${edgeServicePort}`;

        appServiceSubprocess = spawn(
            joinPath(runfilesPath, "cyberworlds/app/app_test.sh"),
            [
                `--port=${appServicePort}`,
                `--edgeServiceUrl=http://localhost:${edgeServicePort}`,
                `--taskRealtimeServiceLocalPort=${taskRealtimeServicePort}`,
                `--appServicePublicKey=${appServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${edgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${taskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${jobQueueServicePublicKeyPath}`,
                `--fileProcessorServicePublicKey=${fileProcessorServicePublicKeyPath}`,
                `--apiServicePublicKey=${apiServicePublicKeyPath}`,
                `--resourceServicePublicKey=${resourceServicePublicKeyPath}`,
                `--servicePrivateKey=${appServicePrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--ensureLocalCachePath=${ensureLocalCachePath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--opensearchLocalPort=${context.getOpensearchLocalPort()}`,
                `--jobQueueUrl=${context.getSqsLocalJobQueueUrl()}`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove original job queue url
                `--fileProcessorJobQueueUrl=${context.getSqsLocalFileProcessorJobQueueUrl()}`,
                `--fileProcessorLightJobQueueUrl=${context.getSqsLocalFileProcessorLightJobQueueUrl()}`,
                `--fileProcessorHeavyJobQueueUrl=${context.getSqsLocalFileProcessorHeavyJobQueueUrl()}`,
                `--allMiniLmL6V2LanguageModel=${allMiniLmL6V2LanguageModelPath}`,
                `--apnsCertificate=${apnsCertificatePath}`,
                `--apnsCertificatePrivateKey=${apnsCertificatePrivateKeyPath}`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
                `--fileProcessorServiceUrl=http://localhost:${fileProcessorServicePort}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
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
                /The one time password for `([^`]+)` is `([^`]+)`/,
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
                `--appServicePublicKey=${appServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${edgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${taskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${jobQueueServicePublicKeyPath}`,
                `--fileProcessorServicePublicKey=${fileProcessorServicePublicKeyPath}`,
                `--apiServicePublicKey=${apiServicePublicKeyPath}`,
                `--resourceServicePublicKey=${resourceServicePublicKeyPath}`,
                `--edgeServiceFamilyPrivateKey=${edgeServiceFamilyPrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--fileProcessorServiceUrl=http://localhost:${fileProcessorServicePort}`,
                `--cacheLocalDataPath=${edgeCacheLocalDataPath}`,
                `--durableObjectsLocalDataPath=${edgeDurableObjectsLocalDataPath}`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
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
                `--appServicePublicKey=${appServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${edgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${taskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${jobQueueServicePublicKeyPath}`,
                `--fileProcessorServicePublicKey=${fileProcessorServicePublicKeyPath}`,
                `--apiServicePublicKey=${apiServicePublicKeyPath}`,
                `--resourceServicePublicKey=${resourceServicePublicKeyPath}`,
                `--servicePrivateKey=${taskRealtimeServicePrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--ensureLocalCachePath=${ensureLocalCachePath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--opensearchLocalPort=${context.getOpensearchLocalPort()}`,
                `--edgeServiceUrl=http://localhost:${edgeServicePort}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
                `--jobQueueUrl=${context.getSqsLocalJobQueueUrl()}`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove original job queue url
                `--fileProcessorJobQueueUrl=${context.getSqsLocalFileProcessorJobQueueUrl()}`,
                `--fileProcessorLightJobQueueUrl=${context.getSqsLocalFileProcessorLightJobQueueUrl()}`,
                `--fileProcessorHeavyJobQueueUrl=${context.getSqsLocalFileProcessorHeavyJobQueueUrl()}`,
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
                `--appServicePublicKey=${appServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${edgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${taskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${jobQueueServicePublicKeyPath}`,
                `--fileProcessorServicePublicKey=${fileProcessorServicePublicKeyPath}`,
                `--apiServicePublicKey=${apiServicePublicKeyPath}`,
                `--resourceServicePublicKey=${resourceServicePublicKeyPath}`,
                `--servicePrivateKey=${jobQueueServicePrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--ensureLocalCachePath=${ensureLocalCachePath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--opensearchLocalPort=${context.getOpensearchLocalPort()}`,
                `--jobQueueUrl=${context.getSqsLocalJobQueueUrl()}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove original job queue url
                `--fileProcessorJobQueueUrl=${context.getSqsLocalFileProcessorJobQueueUrl()}`,
                `--fileProcessorLightJobQueueUrl=${context.getSqsLocalFileProcessorLightJobQueueUrl()}`,
                `--fileProcessorHeavyJobQueueUrl=${context.getSqsLocalFileProcessorHeavyJobQueueUrl()}`,
                `--edgeServiceUrl=http://localhost:${edgeServicePort}`,
                `--allMiniLmL6V2LanguageModel=${allMiniLmL6V2LanguageModelPath}`,
                `--apnsCertificate=${apnsCertificatePath}`,
                `--apnsCertificatePrivateKey=${apnsCertificatePrivateKeyPath}`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
                `--fileProcessorServiceUrl=http://localhost:${fileProcessorServicePort}`,
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

        fileProcessorServiceSubprocess = spawn(
            joinPath(
                runfilesPath,
                "cyberworlds/admin/lambda/local/file_processor_service/lambda_runtime.sh",
            ),
            [
                `--port=${fileProcessorServicePort}`,
                `--sqsLocalPort=${context.getSqsLocalPort()}`,
                `--appServicePublicKey=${appServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${edgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${taskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${jobQueueServicePublicKeyPath}`,
                `--fileProcessorServicePublicKey=${fileProcessorServicePublicKeyPath}`,
                `--apiServicePublicKey=${apiServicePublicKeyPath}`,
                `--resourceServicePublicKey=${resourceServicePublicKeyPath}`,
                `--servicePrivateKey=${fileProcessorServicePrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--ensureLocalCachePath=${ensureLocalCachePath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--edgeServiceUrl=http://localhost:${edgeServicePort}`,
                `--jobQueueUrl=${context.getSqsLocalJobQueueUrl()}`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove original job queue url
                `--fileProcessorJobQueueUrl=${context.getSqsLocalFileProcessorJobQueueUrl()}`,
                `--fileProcessorLightJobQueueUrl=${context.getSqsLocalFileProcessorLightJobQueueUrl()}`,
                `--fileProcessorHeavyJobQueueUrl=${context.getSqsLocalFileProcessorHeavyJobQueueUrl()}`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
                `--temporaryDirectoryPath=${fileProcessorServiceTemporaryDirectoryPath}`,
            ],
            {
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        // For whatever reason, `inherit` doesn't seem to work in Playwright? Manually
        // write data to stdout/stderr.
        fileProcessorServiceSubprocess.stdout.on("data", chunk => process.stdout.write(chunk));
        fileProcessorServiceSubprocess.stderr.on("data", chunk => process.stderr.write(chunk));

        await runAllPromises([
            waitForProcessSpawn(appServiceSubprocess),
            waitForProcessSpawn(edgeServiceSubprocess),
            waitForProcessSpawn(taskRealtimeServiceSubprocess),
            waitForProcessSpawn(jobQueueServiceSubprocess),
            waitForProcessSpawn(fileProcessorServiceSubprocess),
        ]);

        await runAllPromises([
            waitForHttpServer(appServicePort),
            waitForHttpServer(taskRealtimeServicePort),
            waitForHttpServer(fileProcessorServicePort),
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
        const sessionCookieHeader = await getSessionCookieSetCookieHeaderForTest(
            assertExists(appServiceTokenAgentPrivateSide),
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
