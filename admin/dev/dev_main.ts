import chalk from "chalk";
import {ChildProcess} from "child_process";
import chokidar from "chokidar";
import fs from "fs-extra";
import getPort from "get-port";
import {networkInterfaces} from "os";
import {basename, dirname, join as joinPath} from "path";
import {inspect} from "util";
import {
    bazelBuildCompilationMode,
    bazelBuildTargetCpu,
    buildBazelTarget,
} from "~/admin/dev/bazel/build_bazel_target.js";
import {queryBazelTargetDependencyPackagePaths} from "~/admin/dev/bazel/query_bazel_target_dependency_package_paths.js";
import {createDevProxyServer} from "~/admin/dev/dev_proxy_server.js";
import {startRemixDevServer} from "~/admin/dev/remix_dev_server.js";
import {
    spawnWithCoordinatedStdio,
    writeToCoordinatedStderr,
    writeToCoordinatedStdout,
} from "~/admin/dev/stdio_coordinator.js";
import {startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local.js";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
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
import {workspacePath} from "~/admin/helpers/workspace_path.js";
import {startOpensearchLocal} from "~/admin/opensearch/local/start_opensearch_local.js";
import {startSqsLocal} from "~/admin/sqs/local/start_sqs_local.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {
    waitForProcessExit,
    waitForProcessExitWithAnyCode,
} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
import {DeadlineExceededError, InvalidArgumentError} from "~/shared/error/error.js";
import {MutexValue} from "~/shared/helpers/async/mutex_value.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {wait} from "~/shared/helpers/async/wait.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
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

// Assign AWS env variables to `process.env` so
// `@aws-sdk/credential-provider-node` picks them up.
process.env.AWS_ACCESS_KEY_ID = env.AWS_ACCESS_KEY_ID;
process.env.AWS_SECRET_ACCESS_KEY = env.AWS_SECRET_ACCESS_KEY;

const honeycombApiKey = env.HONEYCOMB_API_KEY;

const appDevPort = parsePort(env.APP_DEV_PORT);
const appDevInspectorPort = parsePort(env.APP_DEV_INSPECTOR_PORT);

const edgeDevPort = parsePort(env.EDGE_DEV_PORT);
const edgeDevInspectorPort = parsePort(env.EDGE_DEV_INSPECTOR_PORT);

const taskRealtimeDevPort = parsePort(env.TASK_REALTIME_DEV_PORT);
const taskRealtimeDevInspectorPort = parsePort(env.TASK_REALTIME_DEV_INSPECTOR_PORT);

const jobQueueDevInspectorPort = parsePort(env.JOB_QUEUE_DEV_INSPECTOR_PORT);

const remixDevServerPort = parsePort(env.REMIX_DEV_SERVER_PORT);

const dynamoLocalDataPath = joinPath(devEnvPaths.data, "dynamo");
const dynamoLocalLogsPath = joinPath(devEnvPaths.log, "dynamo");
const dynamoLocalPort = parsePort(env.DYNAMO_LOCAL_PORT);

const opensearchLocalDataPath = joinPath(devEnvPaths.data, "opensearch");
const opensearchLocalLogsPath = joinPath(devEnvPaths.log, "opensearch");
const opensearchLocalPort = parsePort(env.OPENSEARCH_LOCAL_PORT);

const sqsLocalDataPath = joinPath(devEnvPaths.data, "sqs");
const sqsLocalLogsPath = joinPath(devEnvPaths.log, "sqs");
const sqsLocalPort = parsePort(env.SQS_LOCAL_PORT);
const sqsLocalStatsPort = parsePort(env.SQS_LOCAL_STATS_PORT);

export type Artifact = {
    readonly bazelTarget: string;
    readonly executablePath: string;
    readonly stdioPrefix: string;
    readonly env?: {readonly [key: string]: string};
    readonly args?: ReadonlyArray<string>;
    readonly server: MutexValue<ArtifactServer | null>;
    readonly onServerRestart?: () => Promise<void>;
} & (
    | {
          readonly ports?: undefined;
      }
    | {
          readonly ports: {
              readonly publicPort: number;
              privatePort: number;
              readonly privatePortArg?: string;
          };
      }
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

async function createArtifacts() {
    const [privatePort1, privatePort2, privatePort3] = await runAllPromises([
        getPort(),
        getPort(),
        getPort(),
    ]);

    const artifacts: ReadonlyArray<Artifact> = [
        {
            bazelTarget: "//app",
            executablePath: "app/app.sh",
            stdioPrefix: "app",
            env: {BAZEL_BINDIR: "."},
            ports: {
                publicPort: appDevPort,
                privatePort: privatePort1,
            },
            args: [
                `--edgeServiceUrl=http://localhost:${edgeDevPort}`,
                `--appServicePublicKey=${devAppServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${devTaskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${devJobQueueServicePublicKeyPath}`,
                `--servicePrivateKey=${devAppServicePrivateKeyPath}`,
                `--remixDevServerPort=${remixDevServerPort}`,
                "--shouldSeedDynamo",
                `--dynamoLocalPort=${dynamoLocalPort}`,
                `--opensearchLocalPort=${opensearchLocalPort}`,
                `--jobQueueUrl=http://localhost:${sqsLocalPort}/local/JobQueue`,
                `--taskRealtimeServiceLocalPort=${taskRealtimeDevPort}`,
                `--inspectorPort=${appDevInspectorPort}`,
                ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
            ],
            server: new MutexValue<ArtifactServer | null>(null),
            onServerRestart: async () => {
                const remixDevServer = await remixDevServerPromise;
                remixDevServer.reload();
            },
        },
        {
            bazelTarget: "//server/edge",
            executablePath: "server/edge/edge.sh",
            stdioPrefix: "edg",
            ports: {
                publicPort: edgeDevPort,
                privatePort: privatePort2,
            },
            args: [
                `--appServiceUrl=http://localhost:${appDevPort}`,
                `--appServicePublicKey=${devAppServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${devTaskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${devJobQueueServicePublicKeyPath}`,
                `--edgeServiceFamilyPrivateKey=${devEdgeServiceFamilyPrivateKeyPath}`,
                `--inspectorPort=${edgeDevInspectorPort}`,
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
                privatePort: privatePort3,
                // In production we have an HTTP server for each CPU on the machine. In
                // development we only have one HTTP server.
                privatePortArg: "portBase",
            },
            args: [
                `--appServicePublicKey=${devAppServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${devTaskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${devJobQueueServicePublicKeyPath}`,
                `--servicePrivateKey=${devTaskRealtimeServicePrivateKeyPath}`,
                `--dynamoLocalPort=${dynamoLocalPort}`,
                `--opensearchLocalPort=${opensearchLocalPort}`,
                `--jobQueueUrl=http://localhost:${sqsLocalPort}/local/JobQueue`,
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
                `--appServicePublicKey=${devAppServicePublicKeyPath}`,
                `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
                `--taskRealtimeServicePublicKey=${devTaskRealtimeServicePublicKeyPath}`,
                `--jobQueueServicePublicKey=${devJobQueueServicePublicKeyPath}`,
                `--servicePrivateKey=${devJobQueueServicePrivateKeyPath}`,
                `--dynamoLocalPort=${dynamoLocalPort}`,
                `--opensearchLocalPort=${opensearchLocalPort}`,
                `--jobQueueUrl=http://localhost:${sqsLocalPort}/local/JobQueue`,
                `--taskRealtimeServiceLocalPort=${taskRealtimeDevPort}`,
                `--inspectorPort=${jobQueueDevInspectorPort}`,
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

const watcher = chokidar.watch(workspacePath, {
    ignoreInitial: true,
    ignored: /(^|\/)(node_modules|bazel-[^/]+|\.git|\.DS_Store)(\/|$)/,
});

watcher.on("add", processFileUpdate);
watcher.on("change", processFileUpdate);
watcher.on("unlink", processFileUpdate);

let fileUpdateQueue: {
    pauserCount: number;
    paths: Array<string>;
} | null = null;

const remixDevServerPromise = startRemixDevServer({remixDevServerPort, logError});

const fastSetupPromise = runAllPromises([
    ensureDevServiceKeys(),
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
    }),
    remixDevServerPromise,
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
        dataPath: opensearchLocalDataPath,
        logsPath: opensearchLocalLogsPath,
        port: opensearchLocalPort,
    }),
]);

const artifactsPromise = createArtifacts().then(artifacts =>
    runAllPromises(
        artifacts.map(async artifact => {
            await runAllPromises([
                rebuildArtifact(artifact),
                updateArtifactDependencyBazelPackagePaths(artifact),
                artifact.ports
                    ? createDevProxyServer(artifact, {logError, mainPromise: fastMainPromise})
                    : null,
            ]);
        }),
    ),
);

const fastMainPromise = runAllPromises([fastSetupPromise, artifactsPromise]);

const mainPromise = runAllPromises([fastMainPromise, slowSetupPromise]);

void fastMainPromise.then(() => {
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

    writeToCoordinatedStdout(`\


Development environment running on ${chalk.underline(`http://localhost:${edgeDevPort}`)}

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
    await artifact.server.withLock(async artifactServerRef => {
        const privatePortPromise = artifact.ports ? getPort() : null;

        const {buildId, hasFailed: hasBuildFailed} = await buildBazelTarget(artifact.bazelTarget);

        if (artifactServerRef.current) {
            const artifactServer = artifactServerRef.current;

            // If the current artifact server corresponds to the current `buildId` then we
            // don't need to restart it.
            if (artifactServer.buildId === buildId) return;

            if (artifactServer.subprocess) {
                if (artifact.ports) {
                    // Start sending traffic to a new port before we kill the old port.
                    const privatePort = await privatePortPromise;
                    artifact.ports.privatePort = assertExists(privatePort);
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
        }

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

        const executablePath = joinPath(
            `${workspacePath}/bazel-out/${bazelBuildTargetCpu}-${bazelBuildCompilationMode}/bin`,
            artifact.executablePath,
        );

        const subprocess = spawnWithCoordinatedStdio(
            executablePath,
            [
                ...(artifact.ports
                    ? [`--${artifact.ports.privatePortArg ?? "port"}=${artifact.ports.privatePort}`]
                    : []),
                ...(artifact.args ?? []),
            ],
            {
                env: {...process.env, ...artifact.env},
                stdioPrefix: artifact.stdioPrefix,
            },
        );

        const httpServerStartPromise = artifact.ports
            ? PromiseImmediate.resolve(
                  waitForHttpServer(artifact.ports.privatePort).catch(error => {
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
                    waitForProcessExit(subprocess).catch(error => {
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
    readonly dependentArtifactByBazelTarget: Map<string, Artifact>;
};

/**
 * Get the Bazel package for an absolute file path like
 * `/Users/calebmer/Projects/cyberworlds/shared/helpers/control/assert.ts`.
 */
function getBazelPackageByAbsoluteFilePath(path: string): BazelPackage {
    const absoluteDirectoryPath = dirname(path);

    if (
        absoluteDirectoryPath !== workspacePath &&
        !absoluteDirectoryPath.startsWith(`${workspacePath}/`)
    ) {
        throw new InvalidArgumentError(quote`File path is not in Bazel workspace: ${path}`);
    }

    const relativeDirectoryPath =
        absoluteDirectoryPath === workspacePath
            ? "."
            : absoluteDirectoryPath.slice(workspacePath.length + 1);

    return getBazelPackageByRelativeDirectoryPath(relativeDirectoryPath);
}

/**
 * Get the Bazel package for a relative directory path like
 * `shared/helpers/control`.
 */
function getBazelPackageByRelativeDirectoryPath(path: string): BazelPackage {
    const bazelPackage = getOrSetDefaultMapValue(
        bazelPackageByPath,
        path,
        (): BazelPackage | null => {
            const absolutePath = joinPath(workspacePath, path);

            // Only directories are allowed in `bazelPackageByPath`.
            assert(fs.statSync(absolutePath).isDirectory());

            // We use synchronous file system functions to avoid race conditions with
            // chokidar.
            const isBazelPackage =
                fs.pathExistsSync(joinPath(absolutePath, "BUILD.bazel")) ||
                fs.pathExistsSync(joinPath(absolutePath, "BUILD"));

            if (!isBazelPackage) return null;
            return {path, dependentArtifactByBazelTarget: new Map()};
        },
    );

    if (bazelPackage) return bazelPackage;

    const parentPath = dirname(path);

    // We've reached the root directory and there is no package. Stop recursing. In
    // practice we should never hit this since there is a `BUILD` file at the root
    // of our repository.
    assert(path !== parentPath);

    return getBazelPackageByRelativeDirectoryPath(parentPath);
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
        const dependencyPackagePaths = new Set(
            await queryBazelTargetDependencyPackagePaths(artifact.bazelTarget),
        );

        const lastDependencyPackagePaths =
            lastDependencyBazelPackagePathsByTarget.get(artifact.bazelTarget) ?? new Set();

        lastDependencyBazelPackagePathsByTarget.set(artifact.bazelTarget, dependencyPackagePaths);

        const dependencyPackagePathsToAdd = dependencyPackagePaths;
        const dependencyPackagePathsToRemove = new Set<string>();

        for (const lastDependencyPackagePath of lastDependencyPackagePaths) {
            if (!dependencyPackagePathsToAdd.delete(lastDependencyPackagePath)) {
                dependencyPackagePathsToRemove.add(lastDependencyPackagePath);
            }
        }

        for (const dependencyPackagePath of dependencyPackagePathsToAdd) {
            let bazelPackage = bazelPackageByPath.get(dependencyPackagePath);

            if (!bazelPackage) {
                bazelPackage = {
                    path: dependencyPackagePath,
                    dependentArtifactByBazelTarget: new Map(),
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

    const bazelPackage = getBazelPackageByAbsoluteFilePath(path);

    // Rebuild all targets that depend on this package...
    runPromiseWithoutAwaiting(async () => {
        await runAllPromises(
            Array.from(bazelPackage.dependentArtifactByBazelTarget.values(), rebuildArtifact),
        );
    });

    const pathName = basename(path);

    // If some build file changed then not only do we need to rebuild dependent
    // targets, but we also may need to update the dependent target's dependencies
    // since a build file change may add or remove dependencies.
    if (pathName === "BUILD.bazel" || pathName === "BUILD") {
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
