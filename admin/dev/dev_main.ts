import chokidar from "chokidar";
import fs from "fs-extra";
import {basename, dirname, join as joinPath} from "path";
import {buildBazelTarget} from "~/admin/dev/bazel/build_bazel_target.js";
import {queryBazelTargetDependencyPackagePaths} from "~/admin/dev/bazel/query_bazel_target_dependency_package_paths.js";
import {workspacePath} from "~/admin/helpers/workspace_path.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

async function main() {
    const watcher = chokidar.watch(workspacePath, {
        ignored: /(^|\/)(node_modules|bazel-[^/]+|\.git|\.DS_Store)(\/|$)/,
    });

    let isWatcherReady = false;

    watcher.on("ready", () => {
        isWatcherReady = true;
    });

    watcher.on("add", path => {
        if (!isWatcherReady) return;
        processFileUpdate(path);
    });

    watcher.on("change", path => {
        if (!isWatcherReady) return;
        processFileUpdate(path);
    });

    watcher.on("unlink", path => {
        if (!isWatcherReady) return;
        processFileUpdate(path);
    });

    await runAllPromises([
        buildBazelTarget("//app:app_dev"),
        buildBazelTarget("//server/edge:edge_service_bundle_file"),
        updateBazelTargetDependencyPackagePaths("//app:app_dev"),
        updateBazelTargetDependencyPackagePaths("//server/edge:edge_service_bundle_file"),
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
        await runAllPromises(Array.from(bazelPackage.dependentTargets, buildBazelTarget));
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
