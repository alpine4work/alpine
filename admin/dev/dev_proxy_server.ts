import http from "http";
import net from "net";
import {Artifact} from "~/admin/dev/dev_main.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";

// This will be ~30s of retrying.
const retryDurationMs = 50;
const maxRetryAttemptCount = 600;

/**
 * Create a server on `port1` that fully proxies the server on `port2`.
 * However, if the server on `port2` is not currently available we will pause
 * and wait for the server on `port2` to be available before responding. This
 * way a developer may hit the server in their browser and will see a loading
 * spinner while we wait for the server to be ready.
 */
export async function createDevProxyServer(
    artifact: Artifact & {readonly ports: {}},
    {
        logError,
        mainPromise: _mainPromise,
    }: {
        logError: (reason: string, error: unknown) => void;
        mainPromise: Promise<unknown>;
    },
) {
    const mainPromise = PromiseImmediate.resolve(_mainPromise);

    let lastPrivatePort = artifact.ports.privatePort;

    let keepAliveAgent = new http.Agent({keepAlive: true});
    const dontKeepAliveAgent = new http.Agent({keepAlive: false});

    const proxyServer = http.createServer((proxyReq, proxyRes) => {
        let isProxyReqEnded = false;
        const proxyReqChunks: Array<any> = [];

        proxyReq.on("data", chunk => {
            proxyReqChunks.push(chunk);
        });

        proxyReq.on("end", () => {
            isProxyReqEnded = true;
        });

        let requestAttemptCount = 0;

        // Wait for the HTTP server to start before making our first request.
        //
        // TODO(calebmer): I don't think we need request retrying in our proxy anymore
        // if we're waiting on `httpServerStartPromise`? If we can remove the need for
        // retries then maybe we can merge this code with
        // `//server/tasks/realtime/gateway` which would be awesome (since gateway code
        // is based off this code but only run in production).
        mainPromise
            .then(() => {
                const server = artifact.server.getWithoutLock();
                if (!server || server.hasBuildFailed) return;
                return server.httpServerStartPromise;
            })
            .then(request, request);

        function request() {
            // If the server failed to build then return a 500 and tell the developer to
            // look at the terminal.
            const server = artifact.server.getWithoutLock();
            if (server?.hasBuildFailed) {
                proxyRes.writeHead(500, {"content-type": "text/plain"});
                proxyRes.end(`500 Internal Server Error: Bazel build failed (see terminal)`);
                return;
            }

            // If we know the server subprocess is dead then return a 500 and tell the
            // developer to look at the terminal.
            const subprocessExitCode = server?.subprocess.exitCode ?? null;
            if (subprocessExitCode !== null) {
                proxyRes.writeHead(500, {"content-type": "text/plain"});
                proxyRes.end(
                    `500 Internal Server Error: Process exited with code ${subprocessExitCode} (see terminal)`,
                );
                return;
            }

            requestAttemptCount++;

            const privatePort = artifact.ports.privatePort;

            // If the private port changes, then reset the keep-alive agent.
            //
            // TODO(calebmer): Destroy the last keep-alive agent when there are no more
            // ongoing requests? Can't immediately destroy it since there may be a request
            // we're finishing.
            if (lastPrivatePort !== privatePort) {
                lastPrivatePort = privatePort;
                keepAliveAgent = new http.Agent({keepAlive: true});
            }

            const req = http.request({
                agent: keepAliveAgent,
                hostname: "localhost",
                port: privatePort,
                path: proxyReq.url,
                method: proxyReq.method,
                headers: proxyReq.headers,
            });

            req.on("error", error => {
                // If we get an `ECONNREFUSED` error then the server may not have started yet.
                // Try again for a bit. If we still can't connect write an error.
                if (
                    "code" in error &&
                    (error.code === "ECONNREFUSED" || error.code === "ECONNRESET") &&
                    requestAttemptCount < maxRetryAttemptCount
                ) {
                    setTimeout(request, retryDurationMs);
                    return;
                }

                logError("Failed request to proxied server", error);

                proxyRes.writeHead(504, {"content-type": "text/plain"});
                proxyRes.end("504 Gateway Timeout");
            });

            req.on("response", res => {
                res.on("error", error => {
                    logError("Exception in response from proxied server", error);
                });

                proxyRes.writeHead(res.statusCode!, res.statusMessage, res.headers);
                res.pipe(proxyRes, {end: true});
            });

            // If we're retrying a request then we need to replay writing any chunks from
            // our proxy request body.
            for (const chunk of proxyReqChunks) {
                req.write(chunk);
            }

            if (isProxyReqEnded) {
                req.end();
            } else {
                proxyReq.on("data", chunk => {
                    req.write(chunk);
                });

                proxyReq.on("end", () => {
                    req.end();
                });
            }
        }
    });

    proxyServer.on("upgrade", (proxyReq, proxySocket, proxyHead: Uint8Array<ArrayBuffer>) => {
        assert(proxySocket instanceof net.Socket);

        let isProxyReqEnded = false;
        const proxyReqChunks: Array<any> = [];

        proxyReq.on("data", chunk => {
            proxyReqChunks.push(chunk);
        });

        proxyReq.on("end", () => {
            isProxyReqEnded = true;
        });

        proxySocket.on("error", error => {
            // Thrown when the other side of the socket closes. This is normal. Ignore
            // the error.
            // https://stackoverflow.com/questions/2974021/what-does-econnreset-mean-in-the-context-of-an-af-local-socket
            if ("code" in error && (error.code === "ECONNRESET" || error.code === "EPIPE")) return;

            scheduleUncaughtError(error);
        });

        let requestAttemptCount = 0;

        // Wait for the HTTP server to start before making our first request.
        //
        // TODO(calebmer): I don't think we need request retrying in our proxy anymore
        // if we're waiting on `httpServerStartPromise`? If we can remove the need for
        // retries then maybe we can merge this code with
        // `//server/tasks/realtime/gateway` which would be awesome (since gateway code
        // is based off this code but only run in production).
        mainPromise
            .then(() => {
                const server = artifact.server.getWithoutLock();
                if (!server || server.hasBuildFailed) return;
                return server.httpServerStartPromise;
            })
            .then(request, request);

        function request() {
            // If the server failed to build then return a 500 and tell the developer to
            // look at the terminal.
            const server = artifact.server.getWithoutLock();
            if (server?.hasBuildFailed) {
                proxySocket.write(
                    "HTTP/1.1 500 Internal Server Error\r\n" +
                        "Content-Type: text/plain\r\n" +
                        "\r\n" +
                        `500 Internal Server Error: Bazel build failed (see terminal)\r\n`,
                );
                proxySocket.end();
                return;
            }

            // If we know the server subprocess is dead then return a 500 and tell the
            // developer to look at the terminal.
            const subprocessExitCode = server?.subprocess.exitCode ?? null;
            if (subprocessExitCode !== null) {
                proxySocket.write(
                    "HTTP/1.1 500 Internal Server Error\r\n" +
                        "Content-Type: text/plain\r\n" +
                        "\r\n" +
                        `500 Internal Server Error: Process exited with code ${subprocessExitCode} (see terminal)\r\n`,
                );
                proxySocket.end();
                return;
            }

            requestAttemptCount++;

            const privatePort = artifact.ports.privatePort;

            const req = http.request({
                // NOTE(calebmer): Don't keep WebSocket sockets alive. I don't know all the
                // details of TCP keep-alive and the WebSocket protocol but it's causing issues
                // when the partner disconnects from the socket, Node.js is not informed, and
                // we try to reuse it.
                agent: dontKeepAliveAgent,
                hostname: "localhost",
                port: privatePort,
                path: proxyReq.url,
                method: proxyReq.method,
                headers: proxyReq.headers,
            });

            req.on("error", error => {
                // If we get an `ECONNREFUSED` error then the server may not have started yet.
                // Try again for a bit. If we still can't connect write an error.
                if (
                    "code" in error &&
                    (error.code === "ECONNREFUSED" || error.code === "ECONNRESET") &&
                    requestAttemptCount < maxRetryAttemptCount
                ) {
                    setTimeout(request, retryDurationMs);
                    return;
                }

                logError("Failed request to proxied server", error);

                proxySocket.write(
                    "HTTP/1.1 504 Gateway Timeout\r\n" +
                        "Content-Type: text/plain\r\n" +
                        "\r\n" +
                        "504 Gateway Timeout\r\n",
                );
                proxySocket.end();
            });

            req.on("response", res => {
                res.on("error", error => {
                    logError("Exception in response from proxied server", error);
                });

                const headers = [];
                for (let i = 0; i < res.rawHeaders.length; i += 2) {
                    headers.push(`${res.rawHeaders[i]!}: ${res.rawHeaders[i + 1]!}`);
                }

                proxySocket.write(
                    `HTTP/1.1 ${res.statusCode!} ${
                        res.statusMessage ?? http.STATUS_CODES[res.statusCode!]!
                    }\r\n` +
                        `${headers.join("\r\n")}\r\n` +
                        "\r\n",
                );
                res.pipe(proxySocket, {end: true});
            });

            req.on("upgrade", (res, socket, head) => {
                res.on("error", error => {
                    logError("Exception in (upgraded) response from proxied server", error);
                });

                const headers = [];
                for (let i = 0; i < res.rawHeaders.length; i += 2) {
                    headers.push(`${res.rawHeaders[i]!}: ${res.rawHeaders[i + 1]!}`);
                }

                proxySocket.write(
                    `HTTP/1.1 ${res.statusCode!} ${
                        res.statusMessage ?? http.STATUS_CODES[res.statusCode!]!
                    }\r\n` +
                        `${headers.join("\r\n")}\r\n` +
                        "\r\n",
                );

                proxySocket.write(head);
                socket.write(proxyHead);
                proxySocket.pipe(socket, {end: true});
                socket.pipe(proxySocket, {end: true});
            });

            // If we're retrying a request then we need to replay writing any chunks from
            // our proxy request body.
            for (const chunk of proxyReqChunks) {
                req.write(chunk);
            }

            if (isProxyReqEnded) {
                req.end();
            } else {
                proxyReq.on("data", chunk => {
                    req.write(chunk);
                });

                proxyReq.on("end", () => {
                    req.end();
                });
            }
        }
    });

    await new Promise<void>(resolve => {
        proxyServer.listen(artifact.ports.publicPort, resolve);
    });
}
