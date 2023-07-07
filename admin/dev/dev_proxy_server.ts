import http from "http";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";

// This will be ~20s of retrying.
const retryDurationMs = 50;
const maxRetryAttemptCount = 400;

/**
 * Create a server on `port1` that fully proxies the server on `port2`.
 * However, if the server on `port2` is not currently available we will pause
 * and wait for the server on `port2` to be available before responding. This
 * way a developer may hit the server in their browser and will see a loading
 * spinner while we wait for the server to be ready.
 */
export async function createDevProxyServer(port1: number, port2: number) {
    const proxyServer = http.createServer((proxyReq, proxyRes) => {
        let requestAttemptCount = 0;
        request();

        function request() {
            requestAttemptCount++;

            const req = http.request(
                {
                    hostname: "localhost",
                    port: port2,
                    path: proxyReq.url,
                    method: proxyReq.method,
                    headers: proxyReq.headers,
                },
                res => {
                    res.on("error", error => {
                        // eslint-disable-next-line no-console
                        console.error("Exception in response from proxied server:");
                        // eslint-disable-next-line no-console
                        console.error(error);
                    });

                    proxyRes.writeHead(res.statusCode!, res.headers);
                    res.pipe(proxyRes, {end: true});
                },
            );

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
                proxyRes.end("Gateway Timeout");
            });

            proxyReq.pipe(req, {end: true});
        }
    });

    proxyServer.on("upgrade", (proxyReq, proxySocket, proxyHead) => {
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
            requestAttemptCount++;

            const req = http.request(
                {
                    hostname: "localhost",
                    port: port2,
                    path: proxyReq.url,
                    method: proxyReq.method,
                    headers: proxyReq.headers,
                },
                res => {
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
                    res.pipe(proxySocket, {end: true});
                },
            );

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
                    "HTTP/1.1 504 Web Gateway Timeout\r\n" +
                        "Content-Type: text/plain\r\n" +
                        "\r\n" +
                        "Gateway Timeout\r\n",
                );
            });

            proxyReq.pipe(req, {end: true});

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
                proxySocket.pipe(socket, {end: true});
                socket.pipe(proxySocket, {end: true});
            });
        }
    });

    await new Promise<void>(resolve => {
        proxyServer.listen(port1, resolve);
    });
}
