import http from "http";
import net from "net";
import {Artifact} from "~/admin/dev/dev_main.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";

// This will be ~5s of retrying.
const retryDurationMs = 50;
const maxRetryAttemptCount = 100;

/**
 * Create a server on `port1` that fully proxies the server on `port2`.
 * However, if the server on `port2` is not currently available we will pause
 * and wait for the server on `port2` to be available before responding. This
 * way a developer may hit the server in their browser and will see a loading
 * spinner while we wait for the server to be ready.
 */
export async function createDevProxyServer(artifact: Artifact) {
    let lastPrivatePort = artifact.privatePort;

    let keepAliveAgent = new http.Agent({keepAlive: true});
    const dontKeepAliveAgent = new http.Agent({keepAlive: false});

    const proxyServer = http.createServer((proxyReq, proxyRes) => {
        let requestAttemptCount = 0;
        request();

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

            // If the private port changes, then reset the keep-alive agent.
            //
            // TODO(calebmer): Destroy the last keep-alive agent when there are no more
            // ongoing requests? Can't immediately destroy it since there may be a request
            // we're finishing.
            if (lastPrivatePort !== artifact.privatePort) {
                lastPrivatePort = artifact.privatePort;
                keepAliveAgent = new http.Agent({keepAlive: true});
            }

            const req = http.request({
                agent: keepAliveAgent,
                hostname: "localhost",
                port: artifact.privatePort,
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

                // eslint-disable-next-line no-console
                console.error("Failed request to proxied server:");
                // eslint-disable-next-line no-console
                console.error(error);

                proxyRes.writeHead(504, {"content-type": "text/plain"});
                proxyRes.end("504 Gateway Timeout");
            });

            req.on("response", res => {
                res.on("error", error => {
                    // eslint-disable-next-line no-console
                    console.error("Exception in response from proxied server:");
                    // eslint-disable-next-line no-console
                    console.error(error);
                });

                proxyRes.writeHead(res.statusCode!, res.headers);
                res.pipe(proxyRes);
            });

            proxyReq.pipe(req);
        }
    });

    proxyServer.on("upgrade", (proxyReq, proxySocket, proxyHead) => {
        assert(proxySocket instanceof net.Socket);

        proxySocket.on("error", error => {
            // Thrown when the other side of the socket closes. This is normal. Ignore
            // the error.
            // https://stackoverflow.com/questions/2974021/what-does-econnreset-mean-in-the-context-of-an-af-local-socket
            if ("code" in error && (error.code === "ECONNRESET" || error.code === "EPIPE")) return;

            scheduleUncaughtError(error);
        });

        let requestAttemptCount = 0;
        request();

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

            const req = http.request({
                // NOTE(calebmer): Don't keep WebSocket sockets alive. I don't know all the
                // details of TCP keep-alive and the WebSocket protocol but it's causing issues
                // when the partner disconnects from the socket, Node.js is not informed, and
                // we try to reuse it.
                agent: dontKeepAliveAgent,
                hostname: "localhost",
                port: artifact.privatePort,
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

                // eslint-disable-next-line no-console
                console.error("Failed request to proxied server:");
                // eslint-disable-next-line no-console
                console.error(error);

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
                    // eslint-disable-next-line no-console
                    console.error("Exception in response from proxied server:");
                    // eslint-disable-next-line no-console
                    console.error(error);
                });

                const headers = [];
                for (let i = 0; i < res.rawHeaders.length; i += 2) {
                    headers.push(`${res.rawHeaders[i]!}: ${res.rawHeaders[i + 1]!}`);
                }

                proxySocket.write(
                    `HTTP/1.1 ${res.statusCode!} ${http.STATUS_CODES[res.statusCode!]!}\r\n` +
                        `${headers.join("\r\n")}\r\n` +
                        "\r\n",
                );
                res.pipe(proxySocket);
            });

            req.on("upgrade", (res, socket, head) => {
                res.on("error", error => {
                    // eslint-disable-next-line no-console
                    console.error("Exception in (upgraded) response from proxied server:");
                    // eslint-disable-next-line no-console
                    console.error(error);
                });

                const headers = [];
                for (let i = 0; i < res.rawHeaders.length; i += 2) {
                    headers.push(`${res.rawHeaders[i]!}: ${res.rawHeaders[i + 1]!}`);
                }

                proxySocket.write(
                    `HTTP/1.1 ${res.statusCode!} ${http.STATUS_CODES[res.statusCode!]!}\r\n` +
                        `${headers.join("\r\n")}\r\n` +
                        "\r\n",
                );

                proxySocket.write(head);
                socket.write(proxyHead);
                proxySocket.pipe(socket);
                socket.pipe(proxySocket);
            });

            proxyReq.pipe(req);
        }
    });

    await new Promise<void>(resolve => {
        proxyServer.listen(artifact.publicPort, resolve);
    });
}
