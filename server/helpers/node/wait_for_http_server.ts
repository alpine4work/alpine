import {spawn} from "child_process";
import {join as joinPath} from "path";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {waitForProcessExit} from "~/server/helpers/node/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/server/helpers/node/wait_for_process_spawn.js";
import {DeadlineExceededError} from "~/shared/error/error.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {quote} from "~/shared/helpers/string/quote.js";

const originalSetTimeout = setTimeout;

/**
 * Waits for an HTTP server to start listening at the provided host.
 *
 * This was written to wait for our development servers starting up. We don't
 * think there's a use case for this in production.
 */
export async function waitForHttpServer(port: number) {
    // NOTE(calebmer, 2023-10-30): I used to have a `waitForHttpServer()`
    // implementation in Node.js but later discovered it was leaking file
    // descriptors! The file descriptor leak appears to be a [bug in Node.js][1].
    // Replaced the Node.js implementation with a bash implementation which appears
    // to not leak file descriptors. (Though that may only be because the
    // subprocess closing also closes the file descriptors.)
    //
    // NOTE(calebmer, 2023-10-31): Looks like the [file descriptor leak][2] doesn't
    // happen in newer versions of Node.js. We could revert this back to a
    // JavaScript implementation. Leaving for now since I want to see if this
    // implementation actually fixes another issue in my development environment.
    // Before going back to a JavaScript implementation, you should run
    // `lsof -p $PID` on the dev process manager after some service rebuilds to
    // make sure it doesn't accumulate file handles over time.
    //
    // [1]: https://github.com/nodejs/node/issues/50479
    // [2]: https://github.com/nodejs/node/issues/50479#issuecomment-1787152893
    const subprocess = spawn(
        joinPath(runfilesPath, "cyberworlds/server/helpers/node/wait_for_http_server.sh"),
        [String(port)],
        {stdio: ["ignore", "ignore", "ignore"]},
    );

    await waitForProcessSpawn(subprocess);

    const timeoutPromiseResolver = createPromiseResolver();

    // We can't use `wait()` or `setTimeout()` since Jest will override
    // `setTimeout()` when `jest.useFakeTimers()` is on. But we want to wait the
    // timeout anyway.
    const timeoutId = originalSetTimeout(timeoutPromiseResolver.resolve, 60 * 1000);

    try {
        const {hasTimedOut} = await Promise.race([
            waitForProcessExit(subprocess).then(() => ({hasTimedOut: false})),
            timeoutPromiseResolver.promise.then(() => ({hasTimedOut: true})),
        ]);

        if (hasTimedOut) {
            subprocess.kill();
            throw new DeadlineExceededError(
                quote`Timed out waiting for HTTP server on port ${port}`,
            );
        }
    } finally {
        // If the race ends with the process exiting, clear our timeout so it doesn't
        // keep the Node.js process alive while we wait.
        clearTimeout(timeoutId);
    }
}
