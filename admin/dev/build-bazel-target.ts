import chalk from "chalk";
import {spawn} from "child_process";
import {waitForProcessExit} from "~/admin/helpers/wait-for-process-exit";
import {workspacePath} from "~/admin/helpers/workspace-path";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise-resolver";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule-microtask";
import {assert} from "~/shared/helpers/control/assert";
import {DefaultMap} from "~/shared/helpers/map/default-map";

let hasScheduledBuild = false;

let nextBuildByTarget = new DefaultMap<string, PromiseResolver<void>>(createPromiseResolver);

const lastBuildByTarget = new Map<
    string,
    {
        endTime: number;
        promise: Promise<void>;
    }
>();

/**
 * Builds a single Bazel target.
 *
 * If this function is executed multiple times synchronously then we will
 * batch the targets and build them together. If we are already running a Bazel
 * build then we'll batch targets together and build them immediately after.
 */
export function buildBazelTarget(target: string): Promise<void> {
    // If it has been less than 1000ms since the user last built a target, we
    // assume our previous work is still valid. In case the browser is requesting
    // many assets at once.
    const lastBuild = lastBuildByTarget.get(target);
    if (lastBuild && Date.now() - lastBuild.endTime < 1000) {
        return lastBuild.promise;
    }

    const {promise} = nextBuildByTarget.getOrSetDefault(target);
    scheduleBuildBazelTargets();
    return promise;
}

function scheduleBuildBazelTargets() {
    if (hasScheduledBuild) return;
    hasScheduledBuild = true;

    scheduleMicrotask(buildLoop);

    function buildLoop() {
        // Clear `nextBuildByTarget` so that we can collect the next targets to
        // build.
        const buildByTarget = nextBuildByTarget;
        nextBuildByTarget = new DefaultMap(nextBuildByTarget.getDefault);

        actuallyBuildBazelTargets([...buildByTarget.keys()])
            // Resolve the targets we built this run.
            .then(
                () => buildByTarget.forEach(({resolve}) => resolve()),
                error => buildByTarget.forEach(({reject}) => reject(error)),
            )
            .finally(() => {
                // For every target we are building, remember at what time we finished
                // building. This is the latest time we know for certain that the target
                // is up-to-date.
                const buildEndTime = Date.now();
                for (const [target, {promise}] of buildByTarget) {
                    lastBuildByTarget.set(target, {
                        endTime: buildEndTime,
                        promise,
                    });
                }

                // If `buildBazelTarget()` was called while we were executing, then
                // execute Bazel again. We keep executing Bazel until we have no more
                // targets to build.
                if (nextBuildByTarget.size > 0) {
                    buildLoop();
                } else {
                    hasScheduledBuild = false;
                }
            });
    }
}

async function actuallyBuildBazelTargets(targets: Array<string>) {
    assert(targets.length > 0);

    // eslint-disable-next-line no-console
    console.log();
    // eslint-disable-next-line no-console
    console.log();
    // eslint-disable-next-line no-console
    console.log(`${chalk.dim("$")} bazel build ${chalk.bold(targets.join(" "))}`);

    const subprocess = spawn("bazel", ["build", ...targets], {
        cwd: workspacePath,
        env: process.env, // Needs to inherit all of `process.env` so we get the TTY style
        stdio: ["ignore", "inherit", "inherit"],
    });

    await waitForProcessExit(subprocess);
}
