import {ChildProcess} from "child_process";
import chokidar from "chokidar";
import fs from "fs-extra";
import {basename, dirname, join as joinPath} from "path";
import {
    bazelBuildCompilationMode,
    bazelBuildTargetCpu,
    buildBazelTarget,
} from "~/admin/dev/bazel/build_bazel_target.js";
import {queryBazelTargetDependencyPackagePaths} from "~/admin/dev/bazel/query_bazel_target_dependency_package_paths.js";
import {
    devAppServicePrivateKeyPath,
    devAppServicePublicKeyPath,
    devEdgeServiceFamilyPrivateKeyPath,
    devEdgeServiceFamilyPublicKeyPath,
    ensureDevKeys,
} from "~/admin/dev/dev_keys.js";
import {createDevProxyServer} from "~/admin/dev/dev_proxy_server.js";
import {startRemixDevServer} from "~/admin/dev/remix_dev_server.js";
import {spawnWithCoordinatedStdio} from "~/admin/dev/stdio_coordinator.js";
import {startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local.js";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {waitForProcessExit} from "~/admin/helpers/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/admin/helpers/wait_for_process_spawn.js";
import {workspacePath} from "~/admin/helpers/workspace_path.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {AsyncMutex} from "~/shared/helpers/async/async_mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {Id} from "~/shared/id/id.js";

assert(process.env.NODE_ENV === "development");

const env = parseDotenv();

const appPort = parseInt(assertExists(env.APP_PORT), 10);
const appDevPrivatePort = parseInt(assertExists(env.APP_DEV_PRIVATE_PORT), 10);
const honeycombApiKey = env.HONEYCOMB_API_KEY;
const remixDevServerPort = parseInt(assertExists(env.REMIX_DEV_SERVER_PORT), 10);
const dynamoDataDirectoryPath = joinPath(devEnvPaths.data, "dynamo");
const dynamoLocalPort = parseInt(assertExists(env.DYNAMO_LOCAL_PORT), 10);
const edgePort = parseInt(assertExists(env.EDGE_PORT), 10);
const edgeDevPrivatePort = parseInt(assertExists(env.EDGE_DEV_PRIVATE_PORT), 10);

type Artifact = {
    readonly bazelTarget: string;
    readonly executablePath: string;
    readonly port: number;
    readonly privatePort: number;
    readonly env?: {readonly [key: string]: string};
    readonly args?: ReadonlyArray<string>;
    readonly server: AsyncMutex<ArtifactServer | null>;
    readonly onServerRestart?: () => Promise<void>;
};

type ArtifactServer = {
    readonly buildId: Id;
    readonly subprocess: ChildProcess;
};

const artifacts: ReadonlyArray<Artifact> = [
    {
        bazelTarget: "//app",
        executablePath: "app/app.sh",
        env: {BAZEL_BINDIR: "."},
        port: appPort,
        privatePort: appDevPrivatePort,
        args: [
            `--appServicePublicKey=${devAppServicePublicKeyPath}`,
            `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
            `--appServicePrivateKey=${devAppServicePrivateKeyPath}`,
            `--remixDevServerPort=${remixDevServerPort}`,
            `--dynamoLocalPort=${dynamoLocalPort}`,
            "--shouldSeedDynamo",
            ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
        ],
        server: new AsyncMutex<ArtifactServer | null>(null),
        onServerRestart: async () => {
            const remixDevServer = await remixDevServerPromise;
            remixDevServer.reload();
        },
    },
    {
        bazelTarget: "//server/edge",
        executablePath: "server/edge/edge.sh",
        port: edgePort,
        privatePort: edgeDevPrivatePort,
        args: [
            `--appPort=${appPort}`,
            `--appServicePublicKey=${devAppServicePublicKeyPath}`,
            `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
            `--edgeServiceFamilyPrivateKey=${devEdgeServiceFamilyPrivateKeyPath}`,
            ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
        ],
        server: new AsyncMutex<ArtifactServer | null>(null),
    },
];

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

const remixDevServerPromise = startRemixDevServer({remixDevServerPort});

const setupPromise = runAllPromises([
    ensureDevKeys(),
    startDynamoLocal({
        dataPath: dynamoDataDirectoryPath,
        port: dynamoLocalPort,
    }),
    remixDevServerPromise,
]);

const mainPromise = runAllPromises([
    setupPromise,
    runAllPromises(
        artifacts.map(async artifact => {
            await runAllPromises([
                rebuildArtifact(artifact),
                updateArtifactDependencyBazelPackagePaths(artifact),
                createDevProxyServer(artifact.port, artifact.privatePort),
            ]);
        }),
    ),
]);

mainPromise.catch(scheduleUncaughtError);

// Log uncaught exceptions, don't kill the process.
process.on("uncaughtException", error => {
    // eslint-disable-next-line no-console
    console.error("Uncaught exception from dev process manager:", error);
});

/**
 * Build the artifact and restart the server associated with the artifact.
 */
async function rebuildArtifact(artifact: Artifact) {
    const {buildId} = await buildBazelTarget(artifact.bazelTarget);

    await artifact.server.run(async (artifactServer, setArtifactServer) => {
        // If the current artifact server corresponds to the current `buildId` then we
        // don't need to restart it.
        if (artifactServer?.buildId === buildId) return;

        if (artifactServer) {
            const exitPromise = waitForProcessExit(artifactServer.subprocess);
            artifactServer.subprocess.kill("SIGINT");
            await exitPromise;
            setArtifactServer(null);
        }

        // Make sure our setup promise has resolved before spawning our server.
        await setupPromise;

        const subprocess = spawnWithCoordinatedStdio(
            joinPath(
                `${workspacePath}/bazel-out/${bazelBuildTargetCpu}-${bazelBuildCompilationMode}/bin`,
                artifact.executablePath,
            ),
            [`--port=${artifact.privatePort}`, ...(artifact.args ?? [])],
            {env: {...process.env, ...artifact.env}},
        );

        await runAllPromises([waitForProcessSpawn(subprocess), artifact.onServerRestart?.()]);
        setArtifactServer({buildId, subprocess});
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
