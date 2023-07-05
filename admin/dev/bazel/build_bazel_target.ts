import * as colorette from "colorette";
import {bazelExecutablePath, lockBazelExecutable} from "~/admin/dev/bazel/bazel_executable.js";
import {spawnWithBlockingStdio} from "~/admin/dev/stdio_coordinator.js";
import {waitForProcessExit} from "~/admin/helpers/wait_for_process_exit.js";
import {workspacePath} from "~/admin/helpers/workspace_path.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";

/**
 * The target CPU used by `bazel build`.
 */
export const bazelBuildTargetCpu = assertExists(process.env.JS_BINARY__TARGET_CPU);

/**
 * The compilation mode used by `bazel build`.
 */
export const bazelBuildCompilationMode = "fastbuild";

let isBuildScheduled = false;

let nextBuildByTarget = new DefaultMap<string, PromiseResolver<void>>(createPromiseResolver);

const lastBuildByTarget = new Map<
    string,
    {
        startTime: number;
        promise: Promise<void>;
    }
>();

/**
 * Builds a single Bazel target.
 *
 * If this function is executed multiple times in the same stack then we will batch the
 * targets and build them together. If we are already running a Bazel build then we'll
 * batch targets together and build them immediately after.
 */
export function buildBazelTarget(target: string): Promise<void> {
    // If it has been less than 1000ms since the user last built a target, we assume
    // our previous work is still valid.
    const lastBuild = lastBuildByTarget.get(target);
    if (lastBuild && Date.now() - lastBuild.startTime < 1000) {
        return lastBuild.promise;
    }

    const {promise} = nextBuildByTarget.getOrSetDefault(target);
    scheduleBuildBazelTargets();
    return promise;
}

function scheduleBuildBazelTargets() {
    if (isBuildScheduled) return;
    isBuildScheduled = true;

    // Make sure to synchronously lock the Bazel executable while waiting on other
    // build requests to batch.
    void lockBazelExecutable(() => {
        return new Promise<void>(resolve => {
            scheduleMicrotask(buildLoop);

            function buildLoop() {
                // Clear `nextBuildByTarget` so that we can collect the next targets to build.
                const buildByTarget = nextBuildByTarget;
                nextBuildByTarget = new DefaultMap(nextBuildByTarget.getDefault);

                // For every target we are building, remember at what time we started building.
                // This is the latest time we know for certain that the target is up-to-date.
                const buildStartTime = Date.now();
                for (const [target, {promise}] of buildByTarget) {
                    lastBuildByTarget.set(target, {
                        startTime: buildStartTime,
                        promise,
                    });
                }

                actuallyBuildBazelTargets([...buildByTarget.keys()])
                    // Resolve the targets we built this run.
                    .then(
                        () => buildByTarget.forEach(({resolve}) => resolve()),
                        error => buildByTarget.forEach(({reject}) => reject(error)),
                    )
                    .finally(() => {
                        // If `buildBazelTarget()` was called while we were executing, then execute
                        // Bazel again. We keep executing Bazel until we have no more targets to build.
                        if (nextBuildByTarget.size > 0) {
                            buildLoop();
                        } else {
                            isBuildScheduled = false;
                            resolve();
                        }
                    });
            }
        });
    });
}

async function actuallyBuildBazelTargets(targets: Array<string>) {
    assert(targets.length > 0);

    // eslint-disable-next-line no-console
    console.log("");
    // eslint-disable-next-line no-console
    console.log("");
    // eslint-disable-next-line no-console
    console.log(`${colorette.dim("$")} bazel build ${colorette.bold(targets.join(" "))}`);

    const subprocess = spawnWithBlockingStdio(
        bazelExecutablePath,
        [
            "build",
            `--cpu=${bazelBuildTargetCpu}`,
            `--compilation_mode=${bazelBuildCompilationMode}`,
            `--color=${colorette.isColorSupported ? "yes" : "no"}`,
            `--curses=${colorette.isColorSupported ? "yes" : "no"}`,
            ...targets,
        ],
        {
            cwd: workspacePath,
            env: process.env,
        },
    );

    await waitForProcessExit(subprocess);
}
