import {spawn} from "child_process";
import {join as joinPath} from "path";
import {waitForProcessExitWithAnyCode} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {UnknownError} from "~/shared/error/error.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";

/**
 * Acquire the Bazel server lock. Bazel only runs one command at a time.
 * Executing this function will wait for the current command to finish then
 * will lock the server until you call the release function.
 *
 * Useful when building our developer environment if we want to process
 * something in Bazel's output directory (e.g. Vite hot reloads) without
 * interference from Bazel itself.
 *
 * When Bazel isn't running, this function takes 150-170ms to acquire a lock.
 * It's not cheap! We implement this by running a test that loops forever
 * (`bazel test //server/helpers/node:bazel_lock_test`). This is a hack.
 * Ideally Bazel would have a `bazel block` command. Releasing the lock may
 * also take a bit since Bazel needs to clean up the test environment.
 */
export async function acquireBazelLock(): Promise<() => void> {
    const workspacePath = getWorkspacePath();
    const bazelExecutable = joinPath(workspacePath, "admin/vendor/bazelisk/bazelisk");

    console.log(bazelExecutable);

    const subprocess = spawn(
        bazelExecutable,
        [
            "test",
            "//server/helpers/node:bazel_lock_test",
            "--cache_test_results=no",
            "--test_output=streamed",
            "--show_progress_rate_limit=60",
        ],
        {
            cwd: workspacePath,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
        },
    );

    const lockAcquiredPromiseResolver = createPromiseResolver();

    let stdout = "";
    let stderr = "";

    subprocess.stdout.on("data", (chunk: Buffer) => {
        const string = chunk.toString("utf8");
        stdout += string;
    });

    subprocess.stderr.on("data", (chunk: Buffer) => {
        const string = chunk.toString("utf8");
        stderr += string;

        console.log(JSON.stringify(string));

        if (
            !lockAcquiredPromiseResolver.isSettled() &&
            // Check for some strings that tell us the Bazel server lock has been acquired.
            (stderr.includes("Computing main repo mapping") ||
                stderr.includes("Loading:") ||
                stderr.includes("Analyzing:") ||
                stderr.includes("Analyzed target"))
        ) {
            lockAcquiredPromiseResolver.resolve();
        }
    });

    let isReleased = false;

    waitForProcessExitWithAnyCode(subprocess)
        .then(({exitCode}) => {
            if (isReleased) return;

            const outputMessage = `\n\nstdout:\n${stdout.trim()}\n\nstderr:\n${stderr.trim()}`;

            throw new UnknownError(`bazel process exited with code ${exitCode}${outputMessage}`, {
                cause: {exitCode},
            });
        })
        .catch(error => {
            if (isReleased) return;

            if (!lockAcquiredPromiseResolver.isSettled()) {
                lockAcquiredPromiseResolver.reject(error);
            } else {
                scheduleUncaughtError(error);
            }
        });

    await waitForProcessSpawn(subprocess);
    await lockAcquiredPromiseResolver.promise;

    return () => {
        isReleased = true;
        subprocess.kill("SIGKILL");
    };
}
