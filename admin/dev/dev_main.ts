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
    devEdgeServiceFamilyPublicKeyPath,
    ensureDevKeys,
} from "~/admin/dev/dev_keys.js";
import {spawnWithCoordinatedStdio} from "~/admin/dev/stdio_coordinator.js";
import {startDynamoLocal} from "~/admin/dynamo/local/start_dynamo_local.js";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {forceKillProcessTree} from "~/admin/helpers/force_kill_process_tree.js";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
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

assert(process.env.NODE_ENV === "development");

const env = parseDotenv();

const appPort = parseInt(assertExists(env.APP_PORT), 10);
const honeycombApiKey = env.HONEYCOMB_API_KEY;
const remixDevServerPort = parseInt(assertExists(env.REMIX_DEV_SERVER_PORT), 10);
const dynamoDataDirectoryPath = joinPath(devEnvPaths.data, "dynamo");
const dynamoLocalPort = parseInt(assertExists(env.DYNAMO_LOCAL_PORT), 10);

type Artifact = {
    readonly bazelTarget: string;
    readonly executablePath: string;
    readonly env?: {readonly [key: string]: string};
    readonly args?: ReadonlyArray<string>;
};

const artifacts: ReadonlyArray<Artifact> = [
    {
        bazelTarget: "//app",
        executablePath: "app/app.sh",
        env: {BAZEL_BINDIR: "."},
        args: [
            `--port=${appPort}`,
            `--appServicePublicKey=${devAppServicePublicKeyPath}`,
            `--edgeServiceFamilyPublicKey=${devEdgeServiceFamilyPublicKeyPath}`,
            `--appServicePrivateKey=${devAppServicePrivateKeyPath}`,
            `--remixDevServerPort=${remixDevServerPort}`,
            `--dynamoLocalPort=${dynamoLocalPort}`,
            "--shouldSeedDynamo",
            ...(honeycombApiKey ? [`--honeycombApiKey=${honeycombApiKey}`] : []),
        ],
    },
    // {
    //     bazelTarget: "//server/edge:edge_service_bundle_file",
    // },
];

let artifactServerSetupPromise: Promise<unknown> | undefined;

const artifactByBazelTarget = new Map(artifacts.map(artifact => [artifact.bazelTarget, artifact]));

const artifactServerByBazelTarget = new Map<
    string,
    AsyncMutex<{subprocess: ChildProcess | null}>
>();

/**
 * Restart the server for the artifact with the specified Bazel target. If a
 * server is already running then we force kill it and start a new server.
 */
function restartArtifactServer(bazelTarget: string) {
    const artifact = assertExists(artifactByBazelTarget.get(bazelTarget));

    const artifactServerMutex = getOrSetDefaultMapValue(
        artifactServerByBazelTarget,
        bazelTarget,
        () => new AsyncMutex<{subprocess: ChildProcess | null}>({subprocess: null}),
    );

    artifactServerMutex
        .run(async artifactServer => {
            if (artifactServer.subprocess) {
                if (artifactServer.subprocess.pid !== undefined) {
                    await forceKillProcessTree(artifactServer.subprocess.pid);
                }
                artifactServer.subprocess = null;
            }

            // Make sure our setup promise has resolved before spawning our server.
            await artifactServerSetupPromise;

            const subprocess = spawnWithCoordinatedStdio(
                joinPath(
                    `${workspacePath}/bazel-out/${bazelBuildTargetCpu}-${bazelBuildCompilationMode}/bin`,
                    artifact.executablePath,
                ),
                artifact.args ?? [],
                {env: {...process.env, ...artifact.env}},
            );

            await waitForProcessSpawn(subprocess);
            artifactServer.subprocess = subprocess;
        })
        .catch(scheduleUncaughtError);
}

async function main() {
    const watcher = chokidar.watch(workspacePath, {
        ignoreInitial: true,
        ignored: /(^|\/)(node_modules|bazel-[^/]+|\.git|\.DS_Store)(\/|$)/,
    });

    watcher.on("add", processFileUpdate);
    watcher.on("change", processFileUpdate);
    watcher.on("unlink", processFileUpdate);

    artifactServerSetupPromise = runAllPromises([
        ensureDevKeys(),
        startDynamoLocal({
            dataPath: dynamoDataDirectoryPath,
            port: dynamoLocalPort,
        }),
    ]);

    await runAllPromises([
        artifactServerSetupPromise,
        runAllPromises(
            artifacts.map(async artifact => {
                await runAllPromises([
                    (async () => {
                        await buildBazelTarget(artifact.bazelTarget);
                        restartArtifactServer(artifact.bazelTarget);
                    })(),
                    updateBazelTargetDependencyPackagePaths(artifact.bazelTarget),
                ]);
            }),
        ),
    ]);
}

type BazelPackage = {
    readonly path: string;
    readonly dependentTargets: Set<string>;
};

// `null` entries are paths that are definitely not packages. Entries that
// don't exist in the map we don't know whether they are a package or not.
const bazelPackageByPath = new Map<string, BazelPackage | null>();

/**
 * Get the Bazel package for an absolute file path like
 * `/Users/calebmer/Projects/cyberworlds/shared/helpers/control/assert.ts`.
 */
function getBazelPackageByAbsoluteFilePath(path: string): BazelPackage {
    const absoluteDirectoryPath = dirname(path);

    if (!absoluteDirectoryPath.startsWith(`${workspacePath}/`))
        throw new InvalidArgumentError("File path is not in Bazel workspace");

    const relativeDirectoryPath = absoluteDirectoryPath.slice(workspacePath.length + 1);
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
            return {path, dependentTargets: new Set()};
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

const lastDependencyBazelPackagePathsByTarget = new Map<string, ReadonlySet<string>>();

/**
 * Populate `dependentTargets` in `bazelPackageByPath` for the provided target.
 * Pauses file update events while processing to avoid race conditions.
 *
 * If we've already populated `dependentTargets` for this target then we remove
 * any old dependencies which are no longer needed.
 */
function updateBazelTargetDependencyPackagePaths(target: string) {
    return pauseFileUpdates(async () => {
        const dependencyPackagePaths = new Set(
            await queryBazelTargetDependencyPackagePaths(target),
        );

        const lastDependencyPackagePaths =
            lastDependencyBazelPackagePathsByTarget.get(target) ?? new Set();

        lastDependencyBazelPackagePathsByTarget.set(target, dependencyPackagePaths);

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
                bazelPackage = {path: dependencyPackagePath, dependentTargets: new Set()};
                bazelPackageByPath.set(dependencyPackagePath, bazelPackage);
            }

            bazelPackage.dependentTargets.add(target);
        }

        for (const dependencyPackagePath of dependencyPackagePathsToRemove) {
            const bazelPackage = bazelPackageByPath.get(dependencyPackagePath);
            bazelPackage?.dependentTargets.delete(target);
        }
    });
}

let fileUpdateQueue: {
    pauserCount: number;
    paths: Array<string>;
} | null = null;

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
            Array.from(bazelPackage.dependentTargets, async bazelTarget => {
                await buildBazelTarget(bazelTarget);
                restartArtifactServer(bazelTarget);
            }),
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
                Array.from(bazelPackage.dependentTargets, updateBazelTargetDependencyPackagePaths),
            );
        });
    }
}

main().catch(scheduleUncaughtError);

// Log uncaught exceptions, don't kill the process.
process.on("uncaughtException", error => {
    // eslint-disable-next-line no-console
    console.error(error);
});
