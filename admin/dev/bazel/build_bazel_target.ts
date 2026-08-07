import chalk from "chalk";
import {bazelExecutableMutex, bazelExecutablePath} from "~/admin/dev/bazel/bazel_executable.js";
import {spawnWithBlockingStdio} from "~/admin/dev/stdio_coordinator.js";
import {waitForProcessExitWithAnyCode} from "~/server/helpers/node/wait_for_process_exit.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {
    PromiseResolver,
    createPromiseResolver,
} from "~/shared/helpers/async/promise_resolver.open_source.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.open_source.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.open_source.js";
import {Id, generateId} from "~/shared/id/id.open_source.js";
import {BazelBuildEvent} from "~/shared/schema/helpers/bazel_build_event_schema.js";

/**
 * The target CPU used by `bazel build`.
 */
export const bazelBuildTargetCpu = assertExists(process.env.JS_BINARY__TARGET_CPU);

/**
 * The compilation mode used by `bazel build`.
 */
export const bazelBuildCompilationMode = "fastbuild";

let isBuildScheduled = false;

let nextBuildByTarget = new DefaultMap<
    string,
    {
        promiseResolver: PromiseResolver<{buildId: Id; hasFailed: boolean}>;
        onBuildStartCallbacks: Array<(event: {buildId: Id}) => void>;
    }
>(() => ({promiseResolver: createPromiseResolver(), onBuildStartCallbacks: []}));

const lastBuildByTarget = new Map<
    string,
    {
        startTime: number;
        promise: Promise<{buildId: Id; hasFailed: boolean}>;
    }
>();

/**
 * Builds a single Bazel target.
 *
 * If this function is executed multiple times in the same stack then we will batch
 * the targets and build them together. If we are already running a Bazel build
 * then we'll batch targets together and build them immediately after.
 */
export function buildBazelTarget(
    target: string,
    {onBuildStart}: {onBuildStart?: (event: {buildId: Id}) => void} = {},
): Promise<{buildId: Id; hasFailed: boolean}> {
    // If it has been less than 1000ms since the user last built a target, we assume
    // our previous work is still valid.
    const lastBuild = lastBuildByTarget.get(target);
    if (lastBuild && Date.now() - lastBuild.startTime < 1000) {
        return lastBuild.promise;
    }

    const {promiseResolver, onBuildStartCallbacks} = nextBuildByTarget.getOrSetDefault(target);
    if (onBuildStart) onBuildStartCallbacks.push(onBuildStart);
    scheduleBuildBazelTargets();
    return promiseResolver.promise;
}

function scheduleBuildBazelTargets() {
    if (isBuildScheduled) return;
    isBuildScheduled = true;

    // Make sure to synchronously lock the Bazel executable while waiting on other
    // build requests to batch.
    void bazelExecutableMutex.withLock(() => {
        return new Promise<void>(resolve => {
            scheduleMicrotask(buildLoop);

            function buildLoop() {
                // Clear `nextBuildByTarget` so that we can collect the next targets to build.
                const buildByTarget = nextBuildByTarget;
                nextBuildByTarget = nextBuildByTarget.newWithGetDefault();

                const buildId = generateId();
                const event = {buildId};

                // For every target we are building, remember at what time we started building.
                // This is the latest time we know for certain that the target is up-to-date.
                const buildStartTime = Date.now();
                for (const [target, {promiseResolver, onBuildStartCallbacks}] of buildByTarget) {
                    lastBuildByTarget.set(target, {
                        startTime: buildStartTime,
                        promise: promiseResolver.promise,
                    });

                    for (const onBuildStartCallback of onBuildStartCallbacks) {
                        try {
                            onBuildStartCallback(event);
                        } catch (error) {
                            scheduleUncaughtError(error);
                        }
                    }
                }

                actuallyBuildBazelTargets([...buildByTarget.keys()])
                    // Resolve the targets we built this run.
                    .then(
                        ({messageByTarget}) =>
                            buildByTarget.forEach(({promiseResolver}, target) =>
                                promiseResolver.resolve({
                                    buildId,
                                    // We inspect Bazel's target message output to tell us whether a target succeeded
                                    // to build or failed. See Bazel's source code for the possible messages:
                                    //
                                    // https://github.com/bazelbuild/bazel/blob/5c75d0acec21459bbb13520817e3806e1507e907/src/main/java/com/google/devtools/build/lib/buildtool/BuildResultPrinter.java#L279-L320
                                    hasFailed: !(
                                        messageByTarget.get(target)?.includes("up-to-date") ?? false
                                    ),
                                }),
                            ),
                        error =>
                            buildByTarget.forEach(({promiseResolver}) =>
                                promiseResolver.reject(error),
                            ),
                    )
                    .finally(() => {
                        // If `buildBazelTarget()` was called while we were executing, then execute Bazel
                        // again. We keep executing Bazel until we have no more targets to build.
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

    const startTime = Date.now();
    bazelBuildEvents.emit({type: "BuildStart", targets});

    const subprocess = spawnWithBlockingStdio(
        bazelExecutablePath,
        [
            "build",
            `--cpu=${bazelBuildTargetCpu}`,
            `--compilation_mode=${bazelBuildCompilationMode}`,
            `--color=${chalk.supportsColor ? "yes" : "no"}`,
            `--curses=${chalk.supportsColor ? "yes" : "no"}`,
            ...targets,
        ],
        {
            cwd: getWorkspacePath(),
            env: process.env,
            onStdioBlocked: writeStdout => {
                // Explain what the following process output is.
                writeStdout(`\n\n${chalk.dim("$")} bazel build ${chalk.bold(targets.join(" "))}\n`);
            },
        },
    );

    const messageByTarget = new Map<string, string>();

    const handleStdioData = (chunk: Buffer) => {
        const chunkString = chunk.toString();
        const matches = chunkString.matchAll(/Target (\/\/.*?) (.*?)(?::|$)/gm);

        for (const match of matches) {
            const matchTarget = match[1]!;
            const matchMessage = match[2]!;

            for (const target of targets) {
                const canonicalTarget = target.replace(/^(\/\/[^:]*?([^:/]+))$/, "$1:$2");
                if (canonicalTarget === matchTarget) {
                    messageByTarget.set(target, matchMessage);
                }
            }
        }
    };

    subprocess.stdout.on("data", handleStdioData);
    subprocess.stderr.on("data", handleStdioData);

    const {exitCode} = await waitForProcessExitWithAnyCode(subprocess);
    const hasFailed = exitCode !== 0;

    const durationMs = Date.now() - startTime;
    bazelBuildEvents.emit({type: "BuildFinish", targets, durationMs, hasFailed});

    return {messageByTarget};
}

const bazelBuildEvents = new EventEmitter<BazelBuildEvent>();

/**
 * Subscribe to Bazel build events. Useful if you want to log when a Bazel build
 * starts or ends.
 */
export function subscribeToBazelBuildEvents(listener: (event: BazelBuildEvent) => void) {
    return bazelBuildEvents.subscribe(listener);
}
