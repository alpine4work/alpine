import {spawn} from "child_process";
import {join as joinPath} from "path";
import {waitForProcessExit} from "~/admin/helpers/wait_for_process_exit.js";
import {waitForProcessSpawn} from "~/admin/helpers/wait_for_process_spawn.js";
import {DeadlineExceededError} from "~/shared/error/error.js";
import {createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Waits for an HTTP server to start listening at the provided host.
 *
 * This was written to wait for our development servers starting up. We don't
 * think there's a use case for this in production.
 */
export async function waitForHttpServer(port: number) {
    const runfilesPath = assertExists(process.env.RUNFILES);

    // NOTE(calebmer, 2023-10-30): I used to have a `waitForHttpServer()`
    // implementation in Node.js but later discovered it was leaking file
    // descriptors! The file descriptor leak appears to be a [bug in Node.js][1].
    // Replaced the Node.js implementation with a bash implementation which appears
    // to not leak file descriptors. (Though that may only be because the
    // subprocess closing also closes the file descriptors.)
    //
    // [1]: https://github.com/nodejs/node/issues/50479
    const subprocess = spawn(
        joinPath(runfilesPath, "cyberworlds/server/helpers/wait_for_http_server.sh"),
        [String(port)],
        {stdio: ["ignore", "ignore", "ignore"]},
    );

    await waitForProcessSpawn(subprocess);

    const timeoutPromiseResolver = createPromiseResolver();
    const timeout = createTimeout(timeoutPromiseResolver.resolve, 60 * 1000);

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
        timeout.clear();
    }
}
