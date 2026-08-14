import http from "http";
import net from "net";
import {DeadlineExceededError} from "~/shared/error/error.open_source.js";
import {Result} from "~/shared/helpers/control/result.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

// We can't use `wait()` or `setTimeout()` since Jest will override `setTimeout()`
// when `jest.useFakeTimers()` is on. But we want to wait the timeout anyway.
const originalSetTimeout = setTimeout;

/**
 * Waits for an HTTP server to start listening at the provided host.
 *
 * This was written to wait for our development servers starting up. We don't think
 * there's a use case for this in production.
 *
 * First we check if the port is available for TCP connections. Next we make an
 * HTTP request to make sure the HTTP server is responsive. You may customize the
 * path sent to the HTTP server.
 */
export function waitForHttpServer(
    port: number,
    path: string = "/",
    {timeout = 60 * 1000}: {timeout?: number} = {},
) {
    // NOTE(calebmer, 2024-08-07): There used to be a [file descriptor leak in
    // Node.js][1] that's been fixed in v20.9.0 when destroying a socket that failed
    // with a `ECONNREFUSED` error. If you see any `EBADF` errors in your developer
    // environment that may be because the bug has resurfaced and this function is
    // consuming all the operating system's file descriptors.
    //
    // To see if there are excessive open file descriptors try running
    // `lsof -p $PID | grep TCP | wc -l` after some service rebuilds.
    //
    // [1]: https://github.com/nodejs/node/issues/50479
    return new Promise<void>((resolve, reject) => {
        const startTime = Date.now();

        // 1. Wait until the socket becomes available.
        const loop1 = (lastResult: Result<void>) => {
            if (Date.now() - startTime > timeout) {
                reject(
                    new DeadlineExceededError(
                        quote`Timed out waiting for HTTP server on port ${port}`,
                        {cause: !lastResult.ok ? lastResult.error : undefined},
                    ),
                );
                return;
            }

            let isFinished = false;

            const socket = net.connect(port, "localhost");
            socket.setTimeout(Math.min(1000, timeout));

            socket.on("timeout", () => {
                if (isFinished) return;
                isFinished = true;

                socket?.destroy();
                const error = new DeadlineExceededError("Socket timed out");
                originalSetTimeout(() => loop1({ok: false, error}), 50);
            });

            socket.on("error", error => {
                if (isFinished) return;
                isFinished = true;

                socket.destroy();
                originalSetTimeout(() => loop1({ok: false, error}), 50);
            });

            socket.on("connect", () => {
                if (isFinished) return;
                isFinished = true;

                socket.destroy();
                loop2({ok: true, value: undefined});
            });
        };

        // 2. Wait until we can make HTTP requests against the socket.
        const loop2 = (lastResult: Result<void>) => {
            if (Date.now() - startTime > timeout) {
                reject(
                    new DeadlineExceededError(
                        quote`Timed out waiting for HTTP server on port ${port}`,
                        {cause: !lastResult.ok ? lastResult.error : undefined},
                    ),
                );
                return;
            }

            let isFinished = false;

            const request = http.request({
                method: "HEAD",
                hostname: "localhost",
                port,
                path,
            });
            request.setTimeout(Math.min(5 * 1000, timeout));

            request.on("timeout", () => {
                if (isFinished) return;
                isFinished = true;

                request.socket?.destroy();
                const error = new DeadlineExceededError("Socket timed out");
                originalSetTimeout(() => loop2({ok: false, error}), 50);
            });

            request.on("error", error => {
                if (isFinished) return;
                isFinished = true;

                request.socket?.destroy();
                originalSetTimeout(() => loop2({ok: false, error}), 50);
            });

            request.on("response", () => {
                if (isFinished) return;
                isFinished = true;

                request.socket?.destroy();
                resolve();
            });

            request.end();
        };

        loop1({ok: true, value: undefined});
    });
}
