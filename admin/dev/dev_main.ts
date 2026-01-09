import chalk from "chalk";
import {ChildProcess} from "child_process";
import chokidar from "chokidar";
import fs from "fs-extra";
import {networkInterfaces} from "os";
import {basename, dirname, join as joinPath} from "path";
import {inspect} from "util";
import {scheduleDevCronJobs} from "~/admin/cron/schedule_dev_cron_jobs.js";
import {appWrapperPaths} from "~/admin/dev/app_wrapper_paths.js";
import {
    bazelBuildCompilationMode,
    bazelBuildTargetCpu,
    buildBazelTarget,
} from "~/admin/dev/bazel/build_bazel_target.js";
import {queryBazelTargetDependencyPackagePaths} from "~/admin/dev/bazel/query_bazel_target_dependency_package_paths.js";
import {startBazelDevServer} from "~/admin/dev/bazel_dev_server.js";
import {createDevProxyServer} from "~/admin/dev/dev_proxy_server.js";
import {
    spawnWithCoordinatedStdio,
    writeToCoordinatedStderr,
    writeToCoordinatedStdout,
} from "~/admin/dev/stdio_coordinator.js";
import {startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local.js";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {ensureServiceKeys} from "~/admin/helpers/ensure_service_keys.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {startOpensearchLocal} from "~/admin/opensearch/local/start_opensearch_local.js";
import {startSqsLocal} from "~/admin/sqs/local/start_sqs_local.js";
import {getBazelOutputPath} from "~/server/helpers/node/bazel_output_path.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {
    waitForProcessExit,
    waitForProcessExitWithAnyCode,
} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {DeadlineExceededError, InvalidArgumentError} from "~/shared/error/error.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {scheduleMacrotask} from "~/shared/helpers/async/schedule_macrotask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {waitMicrotask} from "~/shared/helpers/async/wait_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {Id} from "~/shared/id/id.js";

assert(process.env.NODE_ENV === "development");

// Make our dev server easy to find in process managers. We include
// "cyberworlds" and "node" so you can grep by those strings.
process.title = "dev (cyberworlds, node)";

const env = parseDotenv();

const parsePort = (portString: string | undefined) => {
    assert(portString);
    const port = parseInt(portString, 10);
    assert(!isNaN(port));
    return port;
};

const parsePorts = (portsString: string | undefined) => {
    assert(portsString);
    return portsString.split(",").map(portString => {
        const port = parseInt(portString, 10);
        assert(!isNaN(port));
        return port;
    });
};

// Assign AWS env variables to `process.env` so
// `@aws-sdk/credential-provider-node` picks them up.
process.env.AWS_ACCESS_KEY_ID = env.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = env.AWS_SECRET_ACCESS_KEY;

const honeycombApiKey = env.HONEYCOMB_API_KEY;
const openAiDevApiKey = env.OPEN_AI_DEV_API_KEY;

const appDevPort = parsePort(env.APP_DEV_PORT);
const appDevInspectorPort = parsePort(env.APP_DEV_INSPECTOR_PORT);
const appDevPrivatePorts = parsePorts(env.APP_DEV_PRIVATE_PORTS);

const edgeDevPort = parsePort(env.EDGE_DEV_PORT);
const edgeDevInspectorPort = parsePort(env.EDGE_DEV_INSPECTOR_PORT);
const edgeDevPrivatePorts = parsePorts(env.EDGE_DEV_PRIVATE_PORTS);
const edgeServiceUrl = `http://localhost:${edgeDevPort}`;

const resourcesDevPort = parsePort(env.RESOURCES_DEV_PORT);
const resourcesDevInspectorPort = parsePort(env.RESOURCES_DEV_INSPECTOR_PORT);
const resourcesDevPrivatePorts = parsePorts(env.RESOURCES_DEV_PRIVATE_PORTS);

const taskRealtimeDevPort = parsePort(env.TASK_REALTIME_DEV_PORT);
const taskRealtimeDevInspectorPort = parsePort(env.TASK_REALTIME_DEV_INSPECTOR_PORT);
const taskRealtimeDevPrivatePorts = parsePorts(env.TASK_REALTIME_DEV_PRIVATE_PORTS);

const jobQueueDevInspectorPort = parsePort(env.JOB_QUEUE_DEV_INSPECTOR_PORT);

const fileProcessorDevPort = parsePort(env.FILE_PROCESSOR_DEV_PORT);
const fileProcessorDevInspectorPort = parsePort(env.FILE_PROCESSOR_DEV_INSPECTOR_PORT);
const fileProcessorDevPrivatePorts = parsePorts(env.FILE_PROCESSOR_DEV_PRIVATE_PORTS);
const fileProcessorServiceTemporaryDirectoryPath = joinPath(devEnvPaths.temp, "files");

const apiDevPort = parsePort(env.API_DEV_PORT);
const apiDevInspectorPort = parsePort(env.API_DEV_INSPECTOR_PORT);
const apiDevPrivatePorts = parsePorts(env.API_DEV_PRIVATE_PORTS);

const agentsDevPort = parsePort(env.AGENTS_DEV_PORT);
const agentsDevInspectorPort = parsePort(env.AGENTS_DEV_INSPECTOR_PORT);
const agentsDevPrivatePorts = parsePorts(env.AGENTS_DEV_PRIVATE_PORTS);

const bazelDevServerPort = parsePort(env.BAZEL_DEV_SERVER_PORT);

const ensureLocalCachePath = joinPath(devEnvPaths.cache, "ensure");

const dynamoLocalDataPath = joinPath(devEnvPaths.data, "dynamo");
const dynamoLocalLogsPath = joinPath(devEnvPaths.log, "dynamo");
const dynamoLocalPort = parsePort(env.DYNAMO_LOCAL_PORT);

const opensearchLocalConfigPath = joinPath(devEnvPaths.config, "opensearch");
const opensearchLocalDataPath = joinPath(devEnvPaths.data, "opensearch");
const opensearchLocalLogsPath = joinPath(devEnvPaths.log, "opensearch");
const opensearchLocalPort = parsePort(env.OPENSEARCH_LOCAL_PORT);

const sqsLocalDataPath = joinPath(devEnvPaths.data, "sqs");
const sqsLocalLogsPath = joinPath(devEnvPaths.log, "sqs");
const sqsLocalPort = parsePort(env.SQS_LOCAL_PORT);
const sqsLocalStatsPort = parsePort(env.SQS_LOCAL_STATS_PORT);

const cloudflareR2LocalDataPath = joinPath(devEnvPaths.data, "r2");

const keysDirectoryPath = joinPath(devEnvPaths.config, "keys");

const appServicePrivateKeyPath = joinPath(keysDirectoryPath, "app_service_rsa");
const appServicePublicKeyPath = joinPath(keysDirectoryPath, "app_service_rsa.pub");

const edgeServiceFamilyPrivateKeyPath = joinPath(keysDirectoryPath, "edge_service_family_rsa");
const edgeServiceFamilyPublicKeyPath = joinPath(keysDirectoryPath, "edge_service_family_rsa.pub");

const taskRealtimeServicePrivateKeyPath = joinPath(keysDirectoryPath, "task_realtime_service_rsa");
const taskRealtimeServicePublicKeyPath = joinPath(
    keysDirectoryPath,
    "task_realtime_service_rsa.pub",
);

const jobQueueServicePrivateKeyPath = joinPath(keysDirectoryPath, "job_queue_service_rsa");
const jobQueueServicePublicKeyPath = joinPath(keysDirectoryPath, "job_queue_service_rsa.pub");

const fileProcessorServicePrivateKeyPath = joinPath(
    keysDirectoryPath,
    "file_processor_service_rsa",
);
const fileProcessorServicePublicKeyPath = joinPath(
    keysDirectoryPath,
    "file_processor_service_rsa.pub",
);

const resourceServicePrivateKeyPath = joinPath(keysDirectoryPath, "resource_service_rsa");
const resourceServicePublicKeyPath = joinPath(keysDirectoryPath, "resource_service_rsa.pub");

const apiServicePrivateKeyPath = joinPath(keysDirectoryPath, "api_service_rsa");
const apiServicePublicKeyPath = joinPath(keysDirectoryPath, "api_service_rsa.pub");

const tokenAgentSecretPath = joinPath(keysDirectoryPath, "token_agent_secret");
const chatGptUnscopedApiKeyPath = joinPath(keysDirectoryPath, "chat_gpt_unscoped_api_key");
const chatGptScopedApiKeyPath = joinPath(keysDirectoryPath, "chat_gpt_scoped_api_key");
const mockChatGptUnscopedApiKeyPath = joinPath(keysDirectoryPath, "mock_chat_gpt_unscoped_api_key");

const apnsCertificatePath = joinPath(
    runfilesPath,
    "cyberworlds/server/apns/certificates/apns_development_certificate.pem",
);
const apnsCertificatePrivateKeyPath = joinPath(
    runfilesPath,
    "cyberworlds/server/apns/certificates/apns_development_certificate_private_key.pem",
);

const externalHost = (() => {
    for (const [name, nets] of Object.entries(networkInterfaces())) {
        if (!nets) continue;
        for (const networkInterface of nets) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            // 'IPv4' is in Node <= 17, from 18 it's a number 4 or 6
            const familyV4Value = typeof networkInterface.family === "string" ? "IPv4" : 4;
            if (networkInterface.family === familyV4Value && !networkInterface.internal) {
                if (name === "en0") {
                    return networkInterface.address;
                }
            }
        }
    }
    return null;
})();

const webPushVapidPublicKeyPath = joinPath(keysDirectoryPath, "web_push_vapid_public_key");
const webPushVapidPrivateKeyPath = joinPath(keysDirectoryPath, "web_push_vapid_private_key");

const stripeSecretKey = env.STRIPE_SECRET_KEY;
const stripeSigningSecret = env.STRIPE_SIGNING_SECRET;

/**
 * An artifact which our dev process manager keeps up-to-date. There are two
 * kinds of artifacts:
 *
 * - File artifacts: These are files that we keep up-to-date but don't execute.
 *   Usually these are resources which'll be loaded on the client.
 *
 * - Executable artifacts: A server which we'll run after building the
 *   artifact. If the artifact rebuilds we'll restart the server.
 */
export type Artifact = {
    /**
     * The Bazel target associated with this artifact. We'll rebuild this
     * target whenever any of its dependencies change.
     */
    readonly bazelTarget: string;
} & (
    | {
          readonly executablePath?: undefined;
          readonly stdioPrefix?: undefined;
          readonly env?: undefined;
          readonly args?: undefined;
          readonly server?: undefined;
          readonly serverRestartPaths?: undefined;
          readonly onServerRestart?: undefined;
          readonly ports?: undefined;
      }
    | ({
          /**
           * Path to the executable built by the artifact's `bazelTarget`. If this path
           * exists, we have an executable artifact. If it doesn't exist we have a files
           * artifact.
           *
           * If we rebuild `bazelTarget` we will kill and restart this executable.
           */
          readonly executablePath: string;

          /**
           * Messages written to `stdout` and `stderr` by our executable will be printed
           * on the dev process manager's `stdout`/`stderr` under the provided prefix.
           *
           * For consistency, please keep the prefix three characters long.
           */
          readonly stdioPrefix: string;

          /**
           * Environment variables to pass to the executable.
           */
          readonly env?: {readonly [key: string]: string};

          /**
           * Arguments to spawn the executable with.
           */
          readonly args?: ReadonlyArray<string>;

          /**
           * Once the build finishes and we spawn the executable, we'll put the
           * `ChildProcess` object in this property. Maintains any state for the running
           * server we might need.
           *
           * When we restart the server we find the old `ChildProcess` in here and
           * kill it.
           */
          readonly server: MutexValue<ArtifactServer | null>;

          /**
           * By default, any file update in our `bazelTarget`'s package will cause us to
           * rebuild the artifact. However, if you provide this option then we'll only
           * rebuild this artifact if the file that updates in our `bazelTarget`'s
           * package is one of the listed files changes.
           *
           * Any file updated in a dependency will still rebuild the artifact. This only
           * affects file updates in our `bazelTarget`'s package.
           */
          readonly serverRestartPaths?: ReadonlySet<string>;

          /**
           * Callback that's called after the server restarts.
           */
          readonly onServerRestart?: () => Promise<void>;
      } & (
          | {
                readonly ports?: undefined;
            }
          | {
                /**
                 * If your executable exposes an HTTP server you use this property to define
                 * its ports. `publicPort` is a stable port we run a proxy on that delays
                 * requests until the executable (running on `privatePort`) is ready to go.
                 *
                 * `JobQueueService` is an example of an executable artifact without an HTTP server.
                 */
                readonly ports: {
                    readonly publicPort: number;
                    readonly privatePorts: ReadonlyArray<number>;
                    privatePortIndex: number;
                    readonly privatePortArg?: string;
                    readonly waitForHttpServerPath?: string;
                };
            }
      ))
);

export type ArtifactServer =
    | {
          readonly buildId: Id;
          readonly hasBuildFailed: false;
          readonly subprocess: ChildProcess;
          readonly httpServerStartPromise: PromiseImmediate<void>;
      }
    | {
          readonly buildId: Id;
          readonly hasBuildFailed: true;
          readonly subprocess: null;
      };

function createArtifacts() {
    const resourceServiceUrl = `http://${externalHost ?? "localhost"}:${resourcesDevPort}`;
    const externalEdgeServiceUrl = `http://${externalHost ?? "localhost"}:${edgeDevPort}`;

    // String with comma-delimited origins that resource service will allow CORS requests from.
    const corsTrustedOrigins = `${edgeServiceUrl}, ${externalEdgeServiceUrl}`;

    const artifacts: ReadonlyArray<Artifact> = [
        // App assets are built with a file artifact then `//app:app_wrapper` runs a
        // lightweight `AppService` which serves Remix routes through a Vite dev
        // server.
        {
            bazelTarget: "//app",
        },
        {
            bazelTarget: "//app:app_wrapper",
            executablePath: "app/app_wrapper.sh",
            serverRestartPaths: appWrapperPaths,
            stdioPrefix: "app",
            env: {BAZEL_BINDIR: "."},
            ports: {
                publicPort: appDevPort,
                privatePorts: appDevPrivatePorts,
                privatePortIndex: 0,
            },
            args: [
                "--viteDev",
                `--bazelDevServerPort=${bazelDevServerPort}`,
                `--appServicePublicKey=${appServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${edgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${taskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${jobQueueServicePublicKeyPath}`,
                `--fileProcessorServicePublicKey=${fileProcessorServicePublicKeyPath}`,
                `--apiServicePublicKey=${apiServicePublicKeyPath}`,
                `--resourceServicePublicKey=${resourceServicePublicKeyPath}`,
                `--servicePrivateKey=${appServicePrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--edgeServiceUrl=${edgeServiceUrl}`,
                `--agentServiceUrl=http://localhost:${agentsDevPort}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
                `--ensureLocalCachePath=${ensureLocalCachePath}`,
                "--shouldSeedDynamo",
                `--dynamoLocalPort=${dynamoLocalPort}`,
                `--opensearchLocalPort=${opensearchLocalPort}`,
                `--jobQueueUrl=http://localhost:${sqsLocalPort}/local/JobQueue`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove original job queue url
                `--fileProcessorJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorJobQueue`,
                `--fileProcessorLightJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorLightJobQueue`,
                `--fileProcessorHeavyJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorHeavyJobQueue`,
                `--taskRealtimeServiceLocalPort=${taskRealtimeDevPort}`,
                `--allMiniLmL6V2LanguageModel=${joinPath(runfilesPath, "all_mini_lm_l6_v2")}`,
                `--inspectorPort=${appDevInspectorPort}`,
                `--apnsCertificate=${apnsCertificatePath}`,
                `--apnsCertificatePrivateKey=${apnsCertificatePrivateKeyPath}`,
                `--webPushVapidPublicKey=${webPushVapidPublicKeyPath}`,
                `--webPushVapidPrivateKey=${webPushVapidPrivateKeyPath}`,
                `--stripeSecretKey=${stripeSecretKey || ""}`,
                `--stripeSigningSecret=${stripeSigningSecret || ""}`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
                `--fileProcessorServiceUrl=http://localhost:${fileProcessorDevPort}`,
                `--agentServiceLocalPort=${agentsDevPort}`,
                `--chatGptLocalUnscopedApiKey=${chatGptUnscopedApiKeyPath}`,
                `--chatGptLocalScopedApiKey=${chatGptScopedApiKeyPath}`,
                `--mockChatGptLocalUnscopedApiKey=${mockChatGptUnscopedApiKeyPath}`,
                ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
            ],
            server: new MutexValue<ArtifactServer | null>(null),
            onServerRestart: async () => {
                const bazelDevServer = await bazelDevServerPromise;
                bazelDevServer.reload();
            },
        },
        {
            bazelTarget: "//server/edge",
            executablePath: "server/edge/edge.sh",
            stdioPrefix: "edg",
            ports: {
                publicPort: edgeDevPort,
                privatePorts: edgeDevPrivatePorts,
                privatePortIndex: 0,
                // Check the `/api/time` path while waiting for the HTTP server to start. We
                // pick this path since it's handled immediately in `EdgeService` and not
                // forwarded to `AppService`. Forwarding requests to `AppService` will stall
                // forever because of a circular dependency. `--appServiceUrl` won't respond to
                // requests until `mainPromise` resolves which requires `EdgeService` to
                // be ready.
                waitForHttpServerPath: "/api/time",
            },
            args: [
                `--appServiceUrl=http://localhost:${appDevPort}`,
                `--appServicePublicKey=${appServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${edgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${taskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${jobQueueServicePublicKeyPath}`,
                `--fileProcessorServicePublicKey=${fileProcessorServicePublicKeyPath}`,
                `--apiServicePublicKey=${apiServicePublicKeyPath}`,
                `--resourceServicePublicKey=${resourceServicePublicKeyPath}`,
                `--edgeServiceFamilyPrivateKey=${edgeServiceFamilyPrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--fileProcessorServiceUrl=http://localhost:${fileProcessorDevPort}`,
                `--cacheLocalDataPath=${joinPath(devEnvPaths.cache, "edge")}`,
                `--durableObjectsLocalDataPath=${joinPath(devEnvPaths.data, "edge/do")}`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
                `--inspectorPort=${edgeDevInspectorPort}`,
                ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
            ],
            server: new MutexValue<ArtifactServer | null>(null),
        },
        {
            bazelTarget: "//server/resources",
            executablePath: "server/resources/resources.sh",
            stdioPrefix: "rsr",
            ports: {
                publicPort: resourcesDevPort,
                privatePorts: resourcesDevPrivatePorts,
                privatePortIndex: 0,
                // Using dedicated healthcheck path for standardization and because some services (like EdgeService) forward requests on "/" to other services
                waitForHttpServerPath: "/healthcheck",
            },
            args: [
                `--appServiceUrl=http://localhost:${appDevPort}`,
                `--edgeServiceUrl=${edgeServiceUrl}`,
                `--fileProcessorServiceUrl=http://localhost:${fileProcessorDevPort}`,
                `--appServicePublicKey=${appServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${edgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${taskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${jobQueueServicePublicKeyPath}`,
                `--fileProcessorServicePublicKey=${fileProcessorServicePublicKeyPath}`,
                `--apiServicePublicKey=${apiServicePublicKeyPath}`,
                `--resourceServicePublicKey=${resourceServicePublicKeyPath}`,
                `--resourceServicePrivateKey=${resourceServicePrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--cacheLocalDataPath=${joinPath(devEnvPaths.cache, "files")}`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
                `--inspectorPort=${resourcesDevInspectorPort}`,
                `--corsTrustedOrigins=${corsTrustedOrigins}`,
                ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
            ],
            server: new MutexValue<ArtifactServer | null>(null),
        },
        {
            bazelTarget: "//server/tasks/realtime",
            executablePath: "server/tasks/realtime/realtime.sh",
            stdioPrefix: "tsk",
            ports: {
                publicPort: taskRealtimeDevPort,
                privatePorts: taskRealtimeDevPrivatePorts,
                privatePortIndex: 0,
                // In production we have an HTTP server for each CPU on the machine. In
                // development we only have one HTTP server.
                privatePortArg: "portBase",
            },
            args: [
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
                `--dynamoLocalPort=${dynamoLocalPort}`,
                `--opensearchLocalPort=${opensearchLocalPort}`,
                `--edgeServiceUrl=${edgeServiceUrl}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
                `--jobQueueUrl=http://localhost:${sqsLocalPort}/local/JobQueue`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove original job queue url
                `--fileProcessorJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorJobQueue`,
                `--fileProcessorLightJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorLightJobQueue`,
                `--fileProcessorHeavyJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorHeavyJobQueue`,
                `--inspectorPort=${taskRealtimeDevInspectorPort}`,
                ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
            ],
            server: new MutexValue<ArtifactServer | null>(null),
        },
        {
            bazelTarget: "//server/jobs/queue",
            executablePath: "server/jobs/queue/queue.sh",
            stdioPrefix: "job",
            args: [
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
                `--dynamoLocalPort=${dynamoLocalPort}`,
                `--opensearchLocalPort=${opensearchLocalPort}`,
                `--jobQueueUrl=http://localhost:${sqsLocalPort}/local/JobQueue`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove original job queue url
                `--fileProcessorJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorJobQueue`,
                `--edgeServiceUrl=${edgeServiceUrl}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
                `--fileProcessorLightJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorLightJobQueue`,
                `--fileProcessorHeavyJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorHeavyJobQueue`,
                `--taskRealtimeServiceLocalPort=${taskRealtimeDevPort}`,
                `--allMiniLmL6V2LanguageModel=${joinPath(runfilesPath, "all_mini_lm_l6_v2")}`,
                `--inspectorPort=${jobQueueDevInspectorPort}`,
                `--apnsCertificate=${apnsCertificatePath}`,
                `--apnsCertificatePrivateKey=${apnsCertificatePrivateKeyPath}`,
                `--webPushVapidPublicKey=${webPushVapidPublicKeyPath}`,
                `--webPushVapidPrivateKey=${webPushVapidPrivateKeyPath}`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
                `--fileProcessorServiceUrl=http://localhost:${fileProcessorDevPort}`,
                ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
            ],
            server: new MutexValue<ArtifactServer | null>(null),
        },
        {
            bazelTarget: "//server/files/processor",
            executablePath: "server/files/processor/processor.sh",
            stdioPrefix: "flp",
            ports: {
                publicPort: fileProcessorDevPort,
                privatePorts: fileProcessorDevPrivatePorts,
                privatePortIndex: 0,
            },
            args: [
                `--inspectorPort=${fileProcessorDevInspectorPort}`,
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
                `--dynamoLocalPort=${dynamoLocalPort}`,
                `--edgeServiceUrl=${edgeServiceUrl}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
                `--jobQueueUrl=http://localhost:${sqsLocalPort}/local/JobQueue`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove original job queue url
                `--fileProcessorJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorJobQueue`,
                `--fileProcessorLightJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorLightJobQueue`,
                `--fileProcessorHeavyJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorHeavyJobQueue`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
                `--temporaryDirectoryPath=${fileProcessorServiceTemporaryDirectoryPath}`,
                ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
                `--sqsLocalPort=${sqsLocalPort}`,
            ],
            server: new MutexValue<ArtifactServer | null>(null),
        },
        {
            bazelTarget: "//server/api",
            executablePath: "server/api/api.sh",
            stdioPrefix: "api",
            env: {BAZEL_BINDIR: "."},
            ports: {
                publicPort: apiDevPort,
                privatePorts: apiDevPrivatePorts,
                privatePortIndex: 0,
            },
            args: [
                `--inspectorPort=${apiDevInspectorPort}`,
                `--appServicePublicKey=${appServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${edgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${taskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${jobQueueServicePublicKeyPath}`,
                `--fileProcessorServicePublicKey=${fileProcessorServicePublicKeyPath}`,
                `--apiServicePublicKey=${apiServicePublicKeyPath}`,
                `--resourceServicePublicKey=${resourceServicePublicKeyPath}`,
                `--servicePrivateKey=${apiServicePrivateKeyPath}`,
                `--tokenAgentSecret=${tokenAgentSecretPath}`,
                `--edgeServiceUrl=${edgeServiceUrl}`,
                `--resourceServiceUrl=${resourceServiceUrl}`,
                `--ensureLocalCachePath=${ensureLocalCachePath}`,
                `--dynamoLocalPort=${dynamoLocalPort}`,
                `--opensearchLocalPort=${opensearchLocalPort}`,
                `--jobQueueUrl=http://localhost:${sqsLocalPort}/local/JobQueue`,
                // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove original job queue url
                `--fileProcessorJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorJobQueue`,
                `--fileProcessorLightJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorLightJobQueue`,
                `--fileProcessorHeavyJobQueueUrl=http://localhost:${sqsLocalPort}/local/FileProcessorHeavyJobQueue`,
                `--taskRealtimeServiceLocalPort=${taskRealtimeDevPort}`,
                `--cloudflareR2LocalDataPath=${cloudflareR2LocalDataPath}`,
                `--fileProcessorServiceUrl=http://localhost:${fileProcessorDevPort}`,
                `--allMiniLmL6V2LanguageModel=${joinPath(runfilesPath, "all_mini_lm_l6_v2")}`,
                ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
            ],
            server: new MutexValue<ArtifactServer | null>(null),
        },
        {
            bazelTarget: "//server/agents",
            executablePath: "server/agents/agents.sh",
            stdioPrefix: "agn",
            ports: {
                publicPort: agentsDevPort,
                privatePorts: agentsDevPrivatePorts,
                privatePortIndex: 0,
            },
            env: {
                // On paid plans, Cloudflare Workers can make up to 1000 subrequests.
                // https://developers.cloudflare.com/workers/platform/limits/#subrequests
                //
                // This environment variable is parsed here:
                // https://github.com/cloudflare/miniflare/blob/b536e56ee19803f0c1fbb922394992bbed7e7c96/packages/shared/src/context.ts#L17-L19
                MINIFLARE_SUBREQUEST_LIMIT: "1000",
            },
            args: [
                `--cacheLocalDataPath=${joinPath(devEnvPaths.cache, "agents")}`,
                `--durableObjectsLocalDataPath=${joinPath(devEnvPaths.data, "agents/do")}`,
                `--d1LocalDataPath=${joinPath(devEnvPaths.data, "agents/d1")}`,
                `--apiServiceUrl=http://localhost:${apiDevPort}`,
                `--chatGptApiServiceKey=${chatGptUnscopedApiKeyPath}`,
                `--mockChatGptApiServiceKey=${mockChatGptUnscopedApiKeyPath}`,
                `--openAiDevApiKey=${openAiDevApiKey}`,
                `--inspectorPort=${agentsDevInspectorPort}`,
                ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
            ],
            server: new MutexValue<ArtifactServer | null>(null),
        },
    ];

    return artifacts;
}

// `null` entries are paths that are definitely not packages. Entries that
// don't exist in the map we don't know whether they are a package or not.
const bazelPackageByPath = new Map<string, BazelPackage | null>();

const lastDependencyBazelPackagePathsByTarget = new Map<string, ReadonlySet<string>>();

const watcher = chokidar.watch(getWorkspacePath(), {
    ignoreInitial: true,
    followSymlinks: false,
    // - `.build` is the Swift build directory for Swift's VSCode integration.
    // - Files like `_tmp_70049_bb0abef9571d51b24d4cd3a2c63d0880` appear to be
    //   generated when running `pnpm patch-commit`.
    ignored: /(^|\/)(node_modules|bazel-[^/]+|\.git|\.DS_Store|\.local|\.build|_tmp[^/]*)(\/|$)/,
});

watcher.on("add", processFileUpdate);
watcher.on("change", processFileUpdate);
watcher.on("unlink", processFileUpdate);

let fileUpdateQueue: {
    pauserCount: number;
    paths: Array<string>;
} | null = null;

const bazelDevServerPromise = startBazelDevServer({port: bazelDevServerPort, logError});

const fastSetupPromise = runAllPromises([
    ensureServiceKeys(keysDirectoryPath),
    startDynamoLocal({
        dataPath: dynamoLocalDataPath,
        logsPath: dynamoLocalLogsPath,
        port: dynamoLocalPort,
    }),
    startSqsLocal({
        dataPath: sqsLocalDataPath,
        logsPath: sqsLocalLogsPath,
        port: sqsLocalPort,
        statsPort: sqsLocalStatsPort,
    }).then(() => {
        // Start running our cron jobs after SQS has started.
        scheduleDevCronJobs({
            jobQueueUrl: `http://localhost:${sqsLocalPort}/local/JobQueue`,
            logError,
        });
    }),
    bazelDevServerPromise,
    // Cleanup `FileProcessorService`'s temporary directory whenever our dev
    // process manager restarts to make sure we start from a clean slate.
    //
    // Ignore error if the directory doesn't exist.
    fs.rm(fileProcessorServiceTemporaryDirectoryPath, {recursive: true}).catch(error => {
        if (isObject(error) && error.code === "ENOENT") return;
        throw error;
    }),
]);

// Don't wait for these promises to resolve before printing that our
// developer environment is ready since it may take a while for these
// promises to resolve.
//
// Consider showing a loading spinner or progress indicator. The developer
// can start using their dev environment even while these services haven't
// started yet! So maybe a spinner is actually a bad idea since the developer
// may think they must wait.
const slowSetupPromise = runAllPromises([
    startOpensearchLocal({
        configPath: opensearchLocalConfigPath,
        dataPath: opensearchLocalDataPath,
        logsPath: opensearchLocalLogsPath,
        port: opensearchLocalPort,
    }),
]);

const artifactsPromise = runAllPromises(
    createArtifacts().map(async artifact => {
        // Allow `fastMainPromise` to initialize.
        await waitMicrotask();

        await runAllPromises([
            rebuildArtifact(artifact),
            updateArtifactDependencyBazelPackagePaths(artifact),
            artifact.ports
                ? createDevProxyServer(artifact, {logError, mainPromise: fastMainPromise})
                : null,
        ]);
    }),
);

const fastMainPromise = runAllPromises([fastSetupPromise, artifactsPromise]);

const mainPromise = runAllPromises([fastMainPromise, slowSetupPromise]);

void fastMainPromise.then(() => {
    writeToCoordinatedStdout(`\


Development environment running on ${chalk.underline(`${edgeServiceUrl}`)}

• Start the Chrome debugger at: ${chalk.underline("chrome://inspect")}
${
    externalHost
        ? `• Other devices on your network can access: ${chalk.underline(
              `http://${externalHost}:${edgeDevPort}`,
          )}\n`
        : ""
}\
• Logs are available at: ${chalk.underline(devEnvPaths.log)}
• Start DynamoDB GUI with: ${chalk.dim("$")} bazel run //admin/dynamo/local:gui


`);
});

mainPromise.catch(scheduleUncaughtError);

// Log uncaught exceptions, don't kill the process.
process.on("uncaughtException", error => {
    logError("Uncaught exception from dev process manager", error);
});

function logError(reason: string, error: unknown) {
    writeToCoordinatedStderr(`${reason}: ${inspect(error, {colors: !!chalk.supportsColor})}\n`);
}

/**
 * Build the artifact and restart the server associated with the artifact.
 */
async function rebuildArtifact(artifact: Artifact) {
    if (!artifact.server) {
        await buildBazelTarget(artifact.bazelTarget);
        return;
    }

    await artifact.server.withLock(async artifactServerRef => {
        let preventStartArtifactServer = false;

        const stopArtifactServer = ({buildId}: {buildId: Id}) => {
            if (!artifactServerRef.current) return;

            const artifactServer = artifactServerRef.current;

            // If the current artifact server corresponds to the current `buildId` then we
            // don't need to restart it.
            if (artifactServer.buildId === buildId) {
                preventStartArtifactServer = true;
                return;
            }

            if (artifactServer.subprocess) {
                // Have `dev_proxy_server.ts` start sending traffic to the next private port.
                if (artifact.ports) {
                    artifact.ports.privatePortIndex =
                        (artifact.ports.privatePortIndex + 1) % artifact.ports.privatePorts.length;
                }

                // If our server process doesn't exit in a reasonable period of time, send
                // `SIGKILL` to force the process to shutdown.
                void Promise.race([
                    wait(1000 * 60 * 2).then(() => false),
                    waitForProcessExitWithAnyCode(artifactServer.subprocess).then(() => true),
                ]).then(hasGracefullyExited => {
                    if (!hasGracefullyExited) {
                        scheduleUncaughtError(
                            new DeadlineExceededError(
                                quote`${artifact.bazelTarget} exceeded graceful exit 2 minute timeout, sending SIGKILL`,
                            ),
                        );
                        artifactServer.subprocess.kill("SIGKILL");
                    }
                });

                // We don't wait for the old process to die. Immediately start sending traffic
                // to the new process.
                artifactServer.subprocess.kill("SIGINT");
            }

            artifactServerRef.current = null;
        };

        const {buildId, hasFailed: hasBuildFailed} = await buildBazelTarget(artifact.bazelTarget, {
            // Stop the artifact server at the start of our Bazel build. That way services
            // like `app_wrapper.sh` which watch for file changes (via Vite) won't see file
            // changes from this build.
            //
            // Our HTTP servers implement graceful shutdown routines. So they'll stay alive
            // until all HTTP connections finish.
            onBuildStart: stopArtifactServer,
        });

        // In case `onBuildStart` didn't run, make sure our artifact server is stopped.
        stopArtifactServer({buildId});

        // If we didn't stop our old artifact server, we shouldn't start an new
        // artifact server.
        if (preventStartArtifactServer) return;

        // If the artifact server failed to build we kill the old artifact server and
        // wait for a successful build.
        if (hasBuildFailed) {
            artifactServerRef.current = {
                buildId,
                hasBuildFailed,
                subprocess: null,
            };
            return;
        }

        // Make sure our setup promise has resolved before spawning our server.
        await fastSetupPromise;

        assert(
            artifact.stdioPrefix.length === 3,
            "All artifact stdio prefixes should be 3 characters long",
        );

        const executablePath = `${getBazelOutputPath()}/${bazelBuildTargetCpu}-${bazelBuildCompilationMode}/bin/${
            artifact.executablePath
        }`;

        const subprocess = spawnWithCoordinatedStdio(
            executablePath,
            [
                ...(artifact.ports
                    ? [
                          `--${artifact.ports.privatePortArg ?? "port"}=${
                              artifact.ports.privatePorts[artifact.ports.privatePortIndex]
                          }`,
                      ]
                    : []),
                ...(artifact.args ?? []),
            ],
            {
                cwd: `${executablePath}.runfiles/cyberworlds`,
                env: {
                    ...process.env,
                    ...artifact.env,
                    // Force usage of colors in our subprocess if colors are supported by our dev
                    // process manager. This environment variable should force the use of colors in
                    // Node.js's native `console.log()` alongside libraries like `chalk` and
                    // `picocolors`.
                    FORCE_COLOR: chalk.supportsColor ? "1" : undefined,
                },
                stdioPrefix: artifact.stdioPrefix,
            },
        );

        const httpServerStartPromise = artifact.ports
            ? PromiseImmediate.resolve(
                  waitForHttpServer(
                      artifact.ports.privatePorts[artifact.ports.privatePortIndex]!,
                      artifact.ports.waitForHttpServerPath,
                  ).catch(() => {
                      // Don't log an error. If a server never starts, the user will see a 504
                      // gateway timeout when they try to access the artifact's URL.
                  }),
              )
            : PromiseImmediate.resolve();

        // Make sure to assign this before our `await` below which may throw if the
        // process exists.
        artifactServerRef.current = {
            buildId,
            hasBuildFailed,
            subprocess,
            httpServerStartPromise,
        };

        await runAllPromises([
            waitForProcessSpawn(subprocess).then(() =>
                Promise.race([
                    httpServerStartPromise,

                    // If the process exits immediately after starting then immediately free the
                    // mutex instead of continuing to wait for the HTTP server to start.
                    waitForProcessExit(subprocess).catch(() => {
                        // Don't log an error. If the process exits, the developer will see when they
                        // try to access the artifact's  URL.
                    }),
                ]),
            ),
            artifact.onServerRestart?.(),
        ]);
    });
}

type BazelPackage = {
    readonly path: string;
    readonly absolutePath: string;
    readonly dependentArtifactByBazelTarget: Map<string, Artifact>;
    readonly serverRestartHotReloadBazelTargets: Set<string>;
};

/**
 * Get the Bazel package for an absolute file path like
 * `/Users/calebmer/Projects/cyberworlds/shared/helpers/control/assert.ts`.
 */
function getBazelPackageByAbsoluteFilePath(path: string): BazelPackage {
    const workspacePath = getWorkspacePath();
    const absoluteDirectoryPath = dirname(path);

    if (
        absoluteDirectoryPath !== workspacePath &&
        !absoluteDirectoryPath.startsWith(`${workspacePath}/`)
    ) {
        throw new InvalidArgumentError(quote`File path is not in Bazel workspace: ${path}`);
    }

    const relativeDirectoryPath =
        absoluteDirectoryPath === workspacePath
            ? ""
            : absoluteDirectoryPath.slice(workspacePath.length + 1);

    return getBazelPackageByRelativeDirectoryPath(relativeDirectoryPath);
}

/**
 * Get the Bazel package for a relative directory path like
 * `shared/helpers/control`.
 */
function getBazelPackageByRelativeDirectoryPath(path: string): BazelPackage {
    const bazelPackage = getBazelPackageByRelativeDirectoryPathWithoutTraversing(path);
    if (bazelPackage) return bazelPackage;

    const parentPath = dirname(path);

    // We've reached the root directory and there is no package. Stop recursing. In
    // practice we should never hit this since there is a `BUILD` file at the root
    // of our repository.
    assert(path !== parentPath);

    return getBazelPackageByRelativeDirectoryPath(parentPath);
}

function getBazelPackageByRelativeDirectoryPathWithoutTraversing(
    path: string,
): BazelPackage | null {
    return getOrSetDefaultMapValue(bazelPackageByPath, path, (): BazelPackage | null => {
        const absolutePath = joinPath(getWorkspacePath(), path);

        // Only directories are allowed in `bazelPackageByPath`.
        assert(fs.statSync(absolutePath).isDirectory());

        // We use synchronous file system functions to avoid race conditions with
        // chokidar.
        const isBazelPackage =
            fs.pathExistsSync(joinPath(absolutePath, "BUILD.bazel")) ||
            fs.pathExistsSync(joinPath(absolutePath, "BUILD"));

        if (!isBazelPackage) return null;
        return {
            path,
            absolutePath,
            dependentArtifactByBazelTarget: new Map(),
            serverRestartHotReloadBazelTargets: new Set(),
        };
    });
}

/**
 * Get the Bazel package for a Bazel target path like
 * `//client/web/styles:styles_bundle_file`.
 */
function getBazelPackageByBazelTarget(bazelTarget: string): BazelPackage {
    assert(bazelTarget.startsWith("//"));
    const bazelPackagePath = bazelTarget.slice(2).split(":", 2)[0]!;
    const bazelPackage = getBazelPackageByRelativeDirectoryPathWithoutTraversing(bazelPackagePath);
    assert(bazelPackage, "Bazel target doesn’t point to a valid Bazel package");
    return bazelPackage;
}

/**
 * Populate `dependentArtifactByBazelTarget` in `bazelPackageByPath` for the
 * provided target. Pauses file update events while processing to avoid race
 * conditions.
 *
 * If we've already populated `dependentArtifactByBazelTarget` for this target
 * then we remove any old dependencies which are no longer needed.
 */
function updateArtifactDependencyBazelPackagePaths(artifact: Artifact) {
    return pauseFileUpdates(async () => {
        const {dependencyPackagePathsToAdd, dependencyPackagePathsToRemove} =
            await diffBazelTargetDependencyPackagePaths(artifact.bazelTarget);

        for (const dependencyPackagePath of dependencyPackagePathsToAdd) {
            let bazelPackage = bazelPackageByPath.get(dependencyPackagePath);

            if (!bazelPackage) {
                bazelPackage = {
                    path: dependencyPackagePath,
                    absolutePath: joinPath(getWorkspacePath(), dependencyPackagePath),
                    dependentArtifactByBazelTarget: new Map(),
                    serverRestartHotReloadBazelTargets: new Set(),
                };
                bazelPackageByPath.set(dependencyPackagePath, bazelPackage);
            }

            bazelPackage.dependentArtifactByBazelTarget.set(artifact.bazelTarget, artifact);
        }

        for (const dependencyPackagePath of dependencyPackagePathsToRemove) {
            const bazelPackage = bazelPackageByPath.get(dependencyPackagePath);
            bazelPackage?.dependentArtifactByBazelTarget.delete(artifact.bazelTarget);
        }
    });
}

async function diffBazelTargetDependencyPackagePaths(bazelTarget: string) {
    const dependencyPackagePaths = new Set(
        await queryBazelTargetDependencyPackagePaths(bazelTarget),
    );

    const lastDependencyPackagePaths =
        lastDependencyBazelPackagePathsByTarget.get(bazelTarget) ?? new Set();

    lastDependencyBazelPackagePathsByTarget.set(bazelTarget, dependencyPackagePaths);

    const dependencyPackagePathsToAdd = dependencyPackagePaths;
    const dependencyPackagePathsToRemove = new Set<string>();

    for (const lastDependencyPackagePath of lastDependencyPackagePaths) {
        if (!dependencyPackagePathsToAdd.delete(lastDependencyPackagePath)) {
            dependencyPackagePathsToRemove.add(lastDependencyPackagePath);
        }
    }

    return {
        dependencyPackagePathsToAdd,
        dependencyPackagePathsToRemove,
    };
}

/**
 * Pauses the processing of files by `processFileUpdate()` until the promise
 * resolves.
 */
async function pauseFileUpdates<Value>(action: () => Promise<Value>): Promise<Value> {
    try {
        fileUpdateQueue ??= {pauserCount: 0, paths: []};
        fileUpdateQueue.pauserCount++;

        return await action();
    } finally {
        if (fileUpdateQueue) {
            fileUpdateQueue.pauserCount--;

            if (fileUpdateQueue.pauserCount === 0) {
                const paths = fileUpdateQueue.paths;
                fileUpdateQueue = null;

                for (const path of paths) {
                    try {
                        processFileUpdate(path);
                    } catch (error) {
                        scheduleUncaughtError(error);
                    }
                }
            }
        }
    }
}

let scheduledProcessFileUpdatePaths: Set<string> | null = null;

/**
 * Whenever a file updates, rebuild any packages that depend on the file.
 *
 * We only keep track of package dependencies, not individual file
 * dependencies, so that if a file is added we don't need to re-query Bazel.
 */
function processFileUpdate(path: string) {
    if (fileUpdateQueue) {
        fileUpdateQueue.paths.push(path);
        return;
    }

    if (scheduledProcessFileUpdatePaths === null) {
        scheduledProcessFileUpdatePaths = new Set();
        scheduleMacrotask(() => {
            assert(scheduledProcessFileUpdatePaths !== null);

            const paths = scheduledProcessFileUpdatePaths;
            scheduledProcessFileUpdatePaths = null;
            actuallyProcessFileUpdates(paths);
        });
    }

    // If many files updated at once (e.g. because of a `git checkout`), we want to
    // process them in a batch. Not individually.
    scheduledProcessFileUpdatePaths.add(path);
}

function actuallyProcessFileUpdates(paths: Set<string>) {
    const artifacts = new Set(
        flatMapIterable(paths, path => {
            const pathBazelPackage = getBazelPackageByAbsoluteFilePath(path);

            // Ignore updates to all files in our root package (e.g. `.gitignore`) except
            // changes to `WORKSPACE` and `pnpm-lock.yaml` which signals a change in our
            // dependencies.
            if (pathBazelPackage.absolutePath === getWorkspacePath()) {
                assert(path.startsWith(`${pathBazelPackage.absolutePath}/`));
                const relativePath = path.slice(pathBazelPackage.absolutePath.length + 1);
                if (relativePath !== "WORKSPACE" && relativePath !== "pnpm-lock.yaml") {
                    return [];
                }
            }

            return filterMapIterable(
                pathBazelPackage.dependentArtifactByBazelTarget,
                ([bazelTarget, artifact]) => {
                    // If our artifact has configured `serverRestartPaths` then if a file is updated
                    // in the artifact's package only a change to a path in `serverRestartPaths`
                    // will cause a rebuild.
                    if (artifact.serverRestartPaths) {
                        const artifactBazelPackage = getBazelPackageByBazelTarget(bazelTarget);

                        if (pathBazelPackage === artifactBazelPackage) {
                            assert(path.startsWith(`${pathBazelPackage.absolutePath}/`));
                            const relativePath = path.slice(
                                pathBazelPackage.absolutePath.length + 1,
                            );

                            if (!artifact.serverRestartPaths.has(relativePath)) {
                                return;
                            }
                        }
                    }

                    return artifact;
                },
            );
        }),
    );

    // Rebuild all targets that depend on this package...
    runPromiseWithoutAwaiting(async () => {
        await runAllPromises(Array.from(artifacts, artifact => rebuildArtifact(artifact)));
    });

    for (const path of paths) {
        const pathName = basename(path);

        // If some build file changed then not only do we need to rebuild dependent
        // targets, but we also may need to update the dependent target's dependencies
        // since a build file change may add or remove dependencies.
        if (pathName === "BUILD.bazel" || pathName === "BUILD") {
            const bazelPackage = getBazelPackageByAbsoluteFilePath(path);

            // If the build file was deleted, remove it from our `bazelPackageByPath` map.
            if (!fs.existsSync(path)) {
                bazelPackageByPath.set(bazelPackage.path, null);
            }

            runPromiseWithoutAwaiting(async () => {
                await runAllPromises(
                    Array.from(
                        bazelPackage.dependentArtifactByBazelTarget.values(),
                        updateArtifactDependencyBazelPackagePaths,
                    ),
                );
            });
        }
    }
}
