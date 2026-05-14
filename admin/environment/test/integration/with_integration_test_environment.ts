/* eslint-disable testing-library/no-debugging-utils */

import {ChildProcessByStdio, spawn} from "child_process";
import fs from "fs/promises";
import getPort from "get-port";
import {join as joinPath} from "path";
import {BrowserContext} from "playwright";
import {parse as parseSetCookieHeader} from "set-cookie-parser";
import {Readable as ReadableStream} from "stream";
import {
    TestActualContext,
    actuallyCreateUnitTestEnvironment,
} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {ensureServiceKeys} from "~/admin/helpers/ensure_service_keys.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {chatInjection} from "~/server/chat/data/chat_injection.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {forumInjection} from "~/server/forum/data/forum_injection.js";
import {runProcess} from "~/server/helpers/node/run_process.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
import {createServiceTokenAgent} from "~/server/node/create_service_token_agent.js";
import {notificationsInjection} from "~/server/notifications/data/notifications_injection.js";
import {searchInjection} from "~/server/search/data/index/search_injection.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TaskRealtimeServiceLocalRouter} from "~/server/tasks/data/task_realtime_service_local_router.js";
import {tasksInjection} from "~/server/tasks/data/tasks_injection.js";
import {getSessionCookieSetCookieHeaderForTest} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {
    TokenAgentAppServicePrivateSide,
    TokenAgentJobQueueServicePrivateSide,
} from "~/server/tokens/token_agent_private_side.js";
import {ConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {ApiKey, assertApiKey} from "~/shared/id/api_key.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";

// This file should only run in a Node.js test environment. Either Jest or
// Playwright.
assert(process.release.name === "node");
assert(isTestNodeEnvOrAdminScenariosScript);

const debug = createDebug(import.meta.url);

const env = parseDotenv();

// Assign AWS env variables to `process.env` so `@aws-sdk/credential-provider-node`
// picks them up. Clear `AWS_PROFILE` and `AWS_SESSION_TOKEN` from the ambient
// shell (developers often have these set for real AWS work) since
// `defaultProvider()` prefers `AWS_PROFILE` over `AWS_ACCESS_KEY_ID`/
// `AWS_SECRET_ACCESS_KEY` and we need our spawned subservices to all use the same
// `"local"` access key as the test process. DynamoDB Local partitions its
// in-memory tables by access key (no `-sharedDb`), so a mismatch would make tables
// written by one process invisible to another.
process.env.AWS_ACCESS_KEY_ID = env.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = env.AWS_SECRET_ACCESS_KEY;
delete process.env.AWS_PROFILE;
delete process.env.AWS_SESSION_TOKEN;

export type TestServices = {
    /**
     * The base URL for our server.
     */
    getBaseUrl(): string;

    /**
     * The base URL for our server.
     *
     * `getBaseUrl()` throws if our services haven't started yet. This returns a
     * promise which resolves once our services are ready.
     */
    waitForBaseUrl(): Promise<string>;

    /**
     * Wait for `JobQueueService` to process all the jobs on the SQS job queue.
     */
    waitForSqsProcessJobs(): Promise<void>;

    /**
     * Get the port `AgentService` is listening on.
     */
    getAgentServicePort(): number;

    /**
     * Get a `TokenAgent` with `AppService`'s private key.
     */
    getAppServiceTokenAgent(): TokenAgent<TokenAgentAppServicePrivateSide>;

    /**
     * Get a `TokenAgent` with `JobQueueService`'s private key.
     */
    getJobQueueServiceTokenAgent(): TokenAgent<TokenAgentJobQueueServicePrivateSide>;

    /**
     * Get the local unscoped API key for the mock ChatGPT bot.
     */
    getMockChatGptLocalUnscopedApiKey(): Promise<ApiKey>;

    /**
     * Get the local unscoped API key for the mock Cursor bot.
     */
    getMockCursorLocalUnscopedApiKey(): Promise<ApiKey>;

    /**
     * Sign a session in to the test browser context by setting the appropriate
     * cookies.
     */
    signIn(
        browserContext: BrowserContext,
        session:
            | {sessionId: SessionId; accountId: AccountId}
            | {id: SessionId; account: {id: AccountId}},
    ): Promise<void>;

    /**
     * Get the one time passwords generated during the current test. The array resets
     * after each test.
     */
    getOneTimePasswords(): ReadonlyArray<{emailAddress: string; oneTimePassword: string}>;

    /**
     * Get the invite URLs generated during the current test. The array resets after
     * each test.
     */
    getInviteUrls(): ReadonlyArray<{emailAddress: string; inviteUrl: string}>;
};

/**
 * Runs a test server for Playwright tests using the test context's DynamoDB. Also
 * sets that server as the base URL for future tests.
 */
export async function withIntegrationTestEnvironment<Value>(
    options: {
        undeclaredOutputsDirectoryPath: string;
        createTemporaryDirectoryPath: () => Promise<string>;
    },
    action: (context: TestActualContext, services: TestServices) => Promise<Value>,
): Promise<Value> {
    const beforeEachCallbacks: Array<() => MaybePromise<void>> = [];
    const afterEachCallbacks: Array<() => MaybePromise<void>> = [];
    const beforeAllCallbacks: Array<() => MaybePromise<void>> = [];
    const afterAllCallbacks: Array<() => MaybePromise<void>> = [];

    const {context, services} = actuallyCreateIntegrationTestEnvironment(
        {
            beforeEach: callback => beforeEachCallbacks.push(callback),
            afterEach: callback => afterEachCallbacks.push(callback),
            beforeAll: callback => beforeAllCallbacks.push(callback),
            afterAll: callback => afterAllCallbacks.push(callback),
        },
        options,
    );

    for (const callback of beforeAllCallbacks) {
        await callback();
    }

    for (const callback of beforeEachCallbacks) {
        await callback();
    }

    try {
        const promiseWaiter = new PromiseWaiter();

        const actualContext = context.cloneWithHelpers({
            process: new ProcessContextModule({
                waitUntil: promise => {
                    promiseWaiter.waitUntil(promise);
                    context.process.waitUntil(promise);
                },
            }),
        });

        const value = await action(actualContext, services);

        // Wait for all `waitUntil()` promises to resolve before cleaning up the
        // environment.
        await promiseWaiter.wait();

        return value;
    } finally {
        for (const callback of afterEachCallbacks) {
            await callback();
        }

        for (const callback of afterAllCallbacks) {
            await callback();
        }
    }
}

/**
 * Creates an integration test environment and the associated `TestActualContext`
 * object. Designed to be used in Playwright tests where setup/teardown is managed
 * by `beforeAll()` and `afterAll()` callbacks.
 *
 * When writing a Playwright test, prefer using `createTestServices()` which
 * provides a more convenient interface for establishing an integration test
 * environment in Playwright.
 *
 * If you need an integration test environment outside of Playwright (e.g. in an
 * adhoc script), use `withIntegrationTestEnvironment()` which automatically
 * manages setup/teardown of the environment for you.
 */
export function actuallyCreateIntegrationTestEnvironment(
    testHooks: {
        beforeEach: (action: () => MaybePromise<void>) => void;
        afterEach: (action: () => MaybePromise<void>) => void;
        beforeAll: (action: () => MaybePromise<void>) => void;
        afterAll: (action: () => MaybePromise<void>) => void;
    },
    {
        undeclaredOutputsDirectoryPath,
        createTemporaryDirectoryPath,
    }: {
        undeclaredOutputsDirectoryPath: string;
        createTemporaryDirectoryPath: () => Promise<string>;
    },
): {
    context: TestActualContext;
    services: TestServices;
} {
    // Important that this comes before `actuallyCreateUnitTestEnvironment()`! We want
    // all our services to finish shutting down before we kill the database services we
    // start in `actuallyCreateUnitTestEnvironment()`.
    //
    // For instance, the job queue needs to finish processing its jobs before we can
    // kill OpenSearch.
    testHooks.afterAll(async () => {
        debug("Stopping services");

        // First wait for `EdgeServiceFamily` to finish since it may need to make requests
        // to `AppService` while finishing up ingress traffic.
        //
        // Catch any errors so we can still shutdown `AppService` even if the shutdown of
        // one of these processes fails.
        const result1 = await captureResultPromise(async () => {
            edgeServiceSubprocess?.kill("SIGINT");

            await runAllPromises([
                edgeServiceSubprocess &&
                    waitForProcessExit(edgeServiceSubprocess).then(() => {
                        debug("`EdgeService` was stopped");
                    }),
            ]);
        });

        edgeServiceSubprocess = undefined;

        const result2 = await captureResultPromise(async () => {
            appServiceSubprocess?.kill("SIGINT");
            taskRealtimeServiceSubprocess?.kill("SIGINT");
            jobQueueServiceSubprocess?.kill("SIGINT");
            fileProcessorServiceSubprocess?.kill("SIGINT");
            apiServiceSubprocess?.kill("SIGINT");
            agentServiceSubprocess?.kill("SIGINT");

            await runAllPromises([
                appServiceSubprocess &&
                    waitForProcessExit(appServiceSubprocess).then(() => {
                        debug("`AppService` was stopped");
                    }),
                taskRealtimeServiceSubprocess &&
                    waitForProcessExit(taskRealtimeServiceSubprocess).then(() => {
                        debug("`TaskRealtimeService` was stopped");
                    }),
                jobQueueServiceSubprocess &&
                    waitForProcessExit(jobQueueServiceSubprocess).then(() => {
                        debug("`JobQueueService` was stopped");
                    }),
                fileProcessorServiceSubprocess &&
                    waitForProcessExit(fileProcessorServiceSubprocess).then(() => {
                        debug("`FileProcessorService` was stopped");
                    }),
                apiServiceSubprocess &&
                    waitForProcessExit(apiServiceSubprocess).then(() => {
                        debug("`ApiService` was stopped");
                    }),
                agentServiceSubprocess &&
                    waitForProcessExit(agentServiceSubprocess).then(() => {
                        debug("`AgentService` was stopped");
                    }),
            ]);
        });

        appServiceSubprocess = undefined;
        jobQueueServiceSubprocess = undefined;
        taskRealtimeServiceSubprocess = undefined;
        fileProcessorServiceSubprocess = undefined;
        apiServiceSubprocess = undefined;
        agentServiceSubprocess = undefined;

        agentServicePort = null;
        taskRealtimeServicePort = null;
        appServiceTokenAgent = null;
        jobQueueServiceTokenAgent = null;
        mockChatGptUnscopedApiKeyPath = null;

        unwrapResult(result1);
        unwrapResult(result2);
    });

    const unitTestContext = actuallyCreateUnitTestEnvironment(testHooks, {
        undeclaredOutputsDirectoryPath,
        createTemporaryDirectoryPath,
        shouldStartOpensearch: true,
        shouldSendJobsToSqs: true,
        chatInjection,
        documentsInjection,
        forumInjection,
        notificationsInjection,
        searchInjection,
        spacesInjection,
        tasksInjection,

        // In integration tests we run the full `TaskRealtimeService` server so when using
        // `context.tasks` you can directly access `TaskRealtimeService`.
        taskContextModule: {
            tokenAgent: () => {
                if (jobQueueServiceTokenAgent === null)
                    throw new InternalError("Test services haven’t initialized");

                return jobQueueServiceTokenAgent;
            },
            router: new TaskRealtimeServiceLocalRouter({
                port: () => {
                    if (taskRealtimeServicePort === null)
                        throw new InternalError("Test services haven’t initialized");

                    return taskRealtimeServicePort;
                },
            }),
        },
    });

    const context = unitTestContext.cloneWithHelpers({
        constants: new ConstantsContextModule({
            edgeServiceUrl: () => {
                if (edgeServicePort === null)
                    throw new InternalError("Test services haven’t initialized");

                return `http://localhost:${edgeServicePort}`;
            },
            // TODO: When we run resource service in integration tests this should update.
            resourceServiceUrl: unitTestContext.constants.resourceServiceUrl,
        }),
    });

    const edgeServicePortPromise = getPort();
    let edgeServicePort: number | null = null;
    void edgeServicePortPromise.then(port => (edgeServicePort = port));

    let taskRealtimeServicePort: number | null = null;
    let agentServicePort: number | null = null;
    let appServiceTokenAgent: TokenAgent<TokenAgentAppServicePrivateSide> | null = null;
    let jobQueueServiceTokenAgent: TokenAgent<TokenAgentJobQueueServicePrivateSide> | null = null;
    let mockChatGptUnscopedApiKeyPath: string | null = null;
    let mockCursorUnscopedApiKeyPath: string | null = null;

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
    let apiServiceSubprocess: ChildProcessByStdio<null, ReadableStream, ReadableStream> | undefined;
    let agentServiceSubprocess:
        | ChildProcessByStdio<null, ReadableStream, ReadableStream>
        | undefined;

    // Cookie names don't have a suffix in tests.
    const cookieNameSuffix = "";

    let oneTimePasswords: Array<{emailAddress: string; oneTimePassword: string}> = [];
    let inviteUrls: Array<{emailAddress: string; inviteUrl: string}> = [];

    testHooks.beforeEach(() => {
        // Clear out one time passwords before the next test.
        oneTimePasswords = [];
        inviteUrls = [];
    });

    testHooks.beforeAll(async () => {
        debug("Starting services");

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
        const agentsCacheLocalDataPath = joinPath(
            context.getTemporaryDirectoryPath(),
            "agents/cache",
        );
        const agentsDurableObjectsLocalDataPath = joinPath(
            context.getTemporaryDirectoryPath(),
            "agents/durable-objects",
        );
        const agentsD1LocalDataPath = joinPath(context.getTemporaryDirectoryPath(), "agents/d1");

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
        const apiServicePrivateKeyPath = joinPath(keysDirectoryPath, "api_service_rsa");

        const importerServicePublicKeyPath = joinPath(
            keysDirectoryPath,
            "importer_service_rsa.pub",
        );

        const tokenAgentSecretPath = joinPath(keysDirectoryPath, "token_agent_secret");

        mockChatGptUnscopedApiKeyPath = joinPath(
            keysDirectoryPath,
            "mock_chat_gpt_unscoped_api_key",
        );

        mockCursorUnscopedApiKeyPath = joinPath(keysDirectoryPath, "mock_cursor_unscoped_api_key");

        const [
            edgeServicePort,
            newTaskRealtimeServicePort,
            appServicePort,
            fileProcessorServicePort,
            apiServicePort,
            newAgentServicePort,
            [newAppServiceTokenAgent, newJobQueueServiceTokenAgent],
        ] = await runAllPromises([
            edgeServicePortPromise,
            getPort(),
            getPort(),
            getPort(),
            getPort(),
            getPort(),
            ensureServiceKeys(keysDirectoryPath).then(() =>
                runAllPromises([
                    createServiceTokenAgent({
                        serviceName: "AppService",
                        privateSide: TokenAgentAppServicePrivateSide,
                        options: {
                            appServicePublicKey: appServicePublicKeyPath,
                            edgeServiceFamilyPublicKey: edgeServiceFamilyPublicKeyPath,
                            taskRealtimeServicePublicKey: taskRealtimeServicePublicKeyPath,
                            jobQueueServicePublicKey: jobQueueServicePublicKeyPath,
                            fileProcessorServicePublicKey: fileProcessorServicePublicKeyPath,
                            apiServicePublicKey: apiServicePublicKeyPath,
                            resourceServicePublicKey: resourceServicePublicKeyPath,
                            importerServicePublicKey: importerServicePublicKeyPath,
                            servicePrivateKey: appServicePrivateKeyPath,
                            tokenAgentSecret: tokenAgentSecretPath,
                        },
                    }),
                    createServiceTokenAgent({
                        serviceName: "JobQueueService",
                        privateSide: TokenAgentJobQueueServicePrivateSide,
                        options: {
                            appServicePublicKey: appServicePublicKeyPath,
                            edgeServiceFamilyPublicKey: edgeServiceFamilyPublicKeyPath,
                            taskRealtimeServicePublicKey: taskRealtimeServicePublicKeyPath,
                            jobQueueServicePublicKey: jobQueueServicePublicKeyPath,
                            fileProcessorServicePublicKey: fileProcessorServicePublicKeyPath,
                            apiServicePublicKey: apiServicePublicKeyPath,
                            resourceServicePublicKey: resourceServicePublicKeyPath,
                            importerServicePublicKey: importerServicePublicKeyPath,
                            servicePrivateKey: jobQueueServicePrivateKeyPath,
                            tokenAgentSecret: tokenAgentSecretPath,
                        },
                    }),
                ]),
            ),
            fs.mkdir(agentsD1LocalDataPath, {recursive: true}).then(async () => {
                const agentsD1LocalDataTarPath = joinPath(
                    runfilesPath,
                    "cyberworlds/server/agents/agents_d1_local_data.tar.gz",
                );

                await runProcess(
                    "tar",
                    ["-xzf", agentsD1LocalDataTarPath, "-C", agentsD1LocalDataPath],
                    {cwd: agentsD1LocalDataPath},
                );
            }),
        ]);
        taskRealtimeServicePort = newTaskRealtimeServicePort;
        agentServicePort = newAgentServicePort;
        appServiceTokenAgent = newAppServiceTokenAgent;
        jobQueueServiceTokenAgent = newJobQueueServiceTokenAgent;

        const allMiniLmL6V2LanguageModelPath = joinPath(runfilesPath, "all_mini_lm_l6_v2");

        const apnsCertificatePath = joinPath(
            runfilesPath,
            "cyberworlds/server/apns/certificates/apns_development_certificate.pem",
        );

        const apnsCertificatePrivateKeyPath = joinPath(
            runfilesPath,
            "cyberworlds/server/apns/certificates/apns_development_certificate_private_key.pem",
        );

        const webPushVapidPublicKeyPath = joinPath(keysDirectoryPath, "web_push_vapid_public_key");
        const webPushVapidPrivateKeyPath = joinPath(
            keysDirectoryPath,
            "web_push_vapid_private_key",
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
                `--importerServicePublicKey=${importerServicePublicKeyPath}`,
                `--servicePrivateKey=${appServicePrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--ensureLocalCachePath=${ensureLocalCachePath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--opensearchLocalPort=${context.getOpensearchLocalPort()}`,
                `--jobQueueUrl=${context.getSqsLocalJobQueueUrl()}`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove
                // original job queue url
                `--fileProcessorJobQueueUrl=${context.getSqsLocalFileProcessorJobQueueUrl()}`,
                `--fileProcessorLightJobQueueUrl=${context.getSqsLocalFileProcessorLightJobQueueUrl()}`,
                `--fileProcessorHeavyJobQueueUrl=${context.getSqsLocalFileProcessorHeavyJobQueueUrl()}`,
                `--allMiniLmL6V2LanguageModel=${allMiniLmL6V2LanguageModelPath}`,
                `--apnsCertificate=${apnsCertificatePath}`,
                `--apnsCertificatePrivateKey=${apnsCertificatePrivateKeyPath}`,
                `--webPushVapidPublicKey=${webPushVapidPublicKeyPath}`,
                `--webPushVapidPrivateKey=${webPushVapidPrivateKeyPath}`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
                `--fileProcessorServiceUrl=http://localhost:${fileProcessorServicePort}`,
                `--agentServiceUrl=http://localhost:${agentServicePort}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
                `--cookieNameSuffix=${cookieNameSuffix}`,
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

            {
                const oneTimePasswordMatch = chunkString.match(
                    /The one time password for `([^`]+)` is `([^`]+)`/,
                );
                if (oneTimePasswordMatch) {
                    oneTimePasswords.push({
                        emailAddress: oneTimePasswordMatch[1],
                        oneTimePassword: oneTimePasswordMatch[2],
                    });
                }
            }

            {
                const inviteUrlMatch = chunkString.match(
                    /Accept the invite for `([^`]+)` in `([^`]+)` here: `([^`]+)`/,
                );
                if (inviteUrlMatch) {
                    inviteUrls.push({
                        emailAddress: inviteUrlMatch[1],
                        inviteUrl: inviteUrlMatch[3],
                    });
                }
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
                `--importerServicePublicKey=${importerServicePublicKeyPath}`,
                `--edgeServiceFamilyPrivateKey=${edgeServiceFamilyPrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--fileProcessorServiceUrl=http://localhost:${fileProcessorServicePort}`,
                `--cacheLocalDataPath=${edgeCacheLocalDataPath}`,
                `--durableObjectsLocalDataPath=${edgeDurableObjectsLocalDataPath}`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
                `--cookieNameSuffix=${cookieNameSuffix}`,
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
                `--importerServicePublicKey=${importerServicePublicKeyPath}`,
                `--servicePrivateKey=${taskRealtimeServicePrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--ensureLocalCachePath=${ensureLocalCachePath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--opensearchLocalPort=${context.getOpensearchLocalPort()}`,
                `--edgeServiceUrl=http://localhost:${edgeServicePort}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
                `--jobQueueUrl=${context.getSqsLocalJobQueueUrl()}`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove
                // original job queue url
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
                `--importerServicePublicKey=${importerServicePublicKeyPath}`,
                `--servicePrivateKey=${jobQueueServicePrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--ensureLocalCachePath=${ensureLocalCachePath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--opensearchLocalPort=${context.getOpensearchLocalPort()}`,
                `--jobQueueUrl=${context.getSqsLocalJobQueueUrl()}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove
                // original job queue url
                `--fileProcessorJobQueueUrl=${context.getSqsLocalFileProcessorJobQueueUrl()}`,
                `--fileProcessorLightJobQueueUrl=${context.getSqsLocalFileProcessorLightJobQueueUrl()}`,
                `--fileProcessorHeavyJobQueueUrl=${context.getSqsLocalFileProcessorHeavyJobQueueUrl()}`,
                `--edgeServiceUrl=http://localhost:${edgeServicePort}`,
                `--allMiniLmL6V2LanguageModel=${allMiniLmL6V2LanguageModelPath}`,
                `--apnsCertificate=${apnsCertificatePath}`,
                `--apnsCertificatePrivateKey=${apnsCertificatePrivateKeyPath}`,
                `--webPushVapidPublicKey=${webPushVapidPublicKeyPath}`,
                `--webPushVapidPrivateKey=${webPushVapidPrivateKeyPath}`,
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
            joinPath(runfilesPath, "cyberworlds/server/files/processor/processor.sh"),
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
                `--importerServicePublicKey=${importerServicePublicKeyPath}`,
                `--servicePrivateKey=${fileProcessorServicePrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--ensureLocalCachePath=${ensureLocalCachePath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--edgeServiceUrl=http://localhost:${edgeServicePort}`,
                `--jobQueueUrl=${context.getSqsLocalJobQueueUrl()}`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove
                // original job queue url
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

        apiServiceSubprocess = spawn(
            joinPath(runfilesPath, "cyberworlds/server/api/api.sh"),
            [
                `--port=${apiServicePort}`,
                `--appServicePublicKey=${appServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${edgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${taskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${jobQueueServicePublicKeyPath}`,
                `--fileProcessorServicePublicKey=${fileProcessorServicePublicKeyPath}`,
                `--apiServicePublicKey=${apiServicePublicKeyPath}`,
                `--resourceServicePublicKey=${resourceServicePublicKeyPath}`,
                `--importerServicePublicKey=${importerServicePublicKeyPath}`,
                `--servicePrivateKey=${apiServicePrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--edgeServiceUrl=http://localhost:${edgeServicePort}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
                `--ensureLocalCachePath=${ensureLocalCachePath}`,
                `--dynamoLocalPort=${context.getDynamoLocalPort()}`,
                `--opensearchLocalPort=${context.getOpensearchLocalPort()}`,
                `--jobQueueUrl=${context.getSqsLocalJobQueueUrl()}`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove
                // original job queue url
                `--fileProcessorJobQueueUrl=${context.getSqsLocalFileProcessorJobQueueUrl()}`,
                `--fileProcessorLightJobQueueUrl=${context.getSqsLocalFileProcessorLightJobQueueUrl()}`,
                `--fileProcessorHeavyJobQueueUrl=${context.getSqsLocalFileProcessorHeavyJobQueueUrl()}`,
                `--taskRealtimeServiceLocalPort=${taskRealtimeServicePort}`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
                `--fileProcessorServiceUrl=http://localhost:${fileProcessorServicePort}`,
                `--allMiniLmL6V2LanguageModel=${allMiniLmL6V2LanguageModelPath}`,
            ],
            {
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        // For whatever reason, `inherit` doesn't seem to work in Playwright? Manually
        // write data to stdout/stderr.
        apiServiceSubprocess.stdout.on("data", chunk => process.stdout.write(chunk));
        apiServiceSubprocess.stderr.on("data", chunk => process.stderr.write(chunk));

        agentServiceSubprocess = spawn(
            joinPath(runfilesPath, "cyberworlds/server/agents/agents.sh"),
            [
                `--port=${agentServicePort}`,
                `--cacheLocalDataPath=${agentsCacheLocalDataPath}`,
                `--durableObjectsLocalDataPath=${agentsDurableObjectsLocalDataPath}`,
                `--d1LocalDataPath=${agentsD1LocalDataPath}`,
                `--apiServiceUrl=http://localhost:${apiServicePort}`,
                `--mockChatGptApiServiceKey=${mockChatGptUnscopedApiKeyPath}`,
                `--mockCursorApiServiceKey=${mockCursorUnscopedApiKeyPath}`,
                // We have an empty D1 database prebuilt with all migrations applied so we
                // shouldn't need to run them again.
                "--withoutD1Migrations",
            ],
            {
                env: process.env,
                stdio: ["ignore", "pipe", "pipe"],
            },
        );

        // For whatever reason, `inherit` doesn't seem to work in Playwright? Manually
        // write data to stdout/stderr.
        agentServiceSubprocess.stdout.on("data", chunk => process.stdout.write(chunk));
        agentServiceSubprocess.stderr.on("data", chunk => process.stderr.write(chunk));

        await runAllPromises([
            waitForProcessSpawn(appServiceSubprocess),
            waitForProcessSpawn(edgeServiceSubprocess),
            waitForProcessSpawn(taskRealtimeServiceSubprocess),
            waitForProcessSpawn(jobQueueServiceSubprocess).then(() => {
                // We don't wait on a port for `JobQueueService` so log once the process has
                // spawned.
                debug("`JobQueueService` is ready");
            }),
            waitForProcessSpawn(fileProcessorServiceSubprocess),
            waitForProcessSpawn(apiServiceSubprocess),
            waitForProcessSpawn(agentServiceSubprocess),
        ]);

        await runAllPromises([
            waitForHttpServer(appServicePort).then(() => {
                debug("`AppService` is ready");
            }),
            waitForHttpServer(taskRealtimeServicePort).then(() => {
                debug("`TaskRealtimeService` is ready");
            }),
            waitForHttpServer(fileProcessorServicePort).then(() => {
                debug("`FileProcessorService` is ready");
            }),
            waitForHttpServer(apiServicePort).then(() => {
                debug("`ApiService` is ready");
            }),
            waitForHttpServer(agentServicePort).then(() => {
                debug("`AgentService` is ready");
            }),
        ]);

        // Wait for `appPort` to be ready before testing `edgePort`. Since testing
        // `edgePort` will forward the request to `appPort` since the edge service proxies
        // our app service.
        await waitForHttpServer(edgeServicePort).then(() => {
            debug("`EdgeService` is ready");
        });
    });

    const signIn = async (
        browserContext: BrowserContext,
        session:
            | {sessionId: SessionId; accountId: AccountId}
            | {id: SessionId; account: {id: AccountId}},
    ) => {
        const sessionCookieHeader = await getSessionCookieSetCookieHeaderForTest(
            assertExists(appServiceTokenAgent).privateSide,
            cookieNameSuffix,
            {
                type: "Session",
                sessionId: "id" in session ? session.id : session.sessionId,
                accountId: "account" in session ? session.account.id : session.accountId,
            },
        );

        await browserContext.addCookies(
            parseSetCookieHeader(sessionCookieHeader).map(cookie => ({
                // Playwright requires a `domain`/`path` pair but outside of production our cookie
                // only has a `path`.
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
                    throw new InternalError("Test services haven’t initialized");

                return `http://localhost:${edgeServicePort}`;
            },
            waitForBaseUrl: async () => {
                const edgeServicePort = await edgeServicePortPromise;
                return `http://localhost:${edgeServicePort}`;
            },
            waitForSqsProcessJobs: () => {
                return context.waitForSqsProcessJobs();
            },
            getAgentServicePort: () => {
                if (agentServicePort === null)
                    throw new InternalError("Test services haven’t initialized");

                return agentServicePort;
            },
            getAppServiceTokenAgent: () => {
                if (appServiceTokenAgent === null)
                    throw new InternalError("Test services haven’t initialized");

                return appServiceTokenAgent;
            },
            getJobQueueServiceTokenAgent: () => {
                if (jobQueueServiceTokenAgent === null)
                    throw new InternalError("Test services haven’t initialized");

                return jobQueueServiceTokenAgent;
            },
            getMockChatGptLocalUnscopedApiKey: async () => {
                if (mockChatGptUnscopedApiKeyPath === null)
                    throw new InternalError("Test services haven’t initialized");

                const apiKey = await fs.readFile(mockChatGptUnscopedApiKeyPath, "utf8");
                return assertApiKey(apiKey.trim());
            },
            getMockCursorLocalUnscopedApiKey: async () => {
                if (mockCursorUnscopedApiKeyPath === null)
                    throw new InternalError("Test services haven\u2019t initialized");

                const apiKey = await fs.readFile(mockCursorUnscopedApiKeyPath, "utf8");
                return assertApiKey(apiKey.trim());
            },
            signIn,
            getOneTimePasswords: () => oneTimePasswords.slice(),
            getInviteUrls: () => inviteUrls.slice(),
        },
    };
}
