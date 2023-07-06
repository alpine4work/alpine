import http from "http";
import {WebSocket, WebSocketServer} from "ws";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";

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
                console.error("Failed request to proxied server:", error);

                proxyRes.writeHead(504, {"content-type": "text/plain"});
                proxyRes.end("Gateway Timeout");
            });

            proxyReq.pipe(req, {end: true});
        }
    });

    const proxyWebSocketServer = new WebSocketServer({server: proxyServer});

    proxyWebSocketServer.on("connection", (proxySocket, proxyReq) => {
        let connectAttemptCount = 0;

        let state:
            | {type: "Open"; socket: WebSocket}
            | {type: "Connecting"; callbacks: Array<(socket: WebSocket) => void>} = {
            type: "Connecting",
            callbacks: [],
        };

        proxySocket.on("message", (rawData, isBinary) => {
            const data = isBinary ? rawData : rawData.toString();

            if (state.type === "Connecting") {
                state.callbacks.push(socket => socket.send(data));
            } else if (state.socket.readyState === WebSocket.OPEN) {
                state.socket.send(data);
            }
        });

        proxySocket.on("close", (code, reason) => {
            if (code === 1005 || code === 1006) code = 1011;

            if (state.type === "Connecting") {
                state.callbacks.push(socket => socket.close(code, reason));
            } else if (state.socket.readyState === WebSocket.OPEN) {
                state.socket.close(code, reason);
            }
        });

        connect();

        function connect() {
            assert(state.type === "Connecting");
            connectAttemptCount++;
            let isRetrying = false;

            const socket = new WebSocket(`ws://localhost:${port2}${proxyReq.url ?? ""}`, {
                headers: proxyReq.headers,
            });

            socket.on("open", () => {
                if (isRetrying) return;

                if (state.type === "Connecting") {
                    for (const callback of state.callbacks) {
                        try {
                            callback(socket);
                        } catch (error) {
                            scheduleUncaughtError(error);
                        }
                    }

                    state = {type: "Open", socket};
                }
            });

            socket.on("error", error => {
                if (isRetrying) return;

                // If we get an `ECONNREFUSED` error then the server may not have started yet.
                // Try again for a bit. If we still can't connect write an error.
                if (
                    state.type === "Connecting" &&
                    "code" in error &&
                    (error.code === "ECONNREFUSED" || error.code === "ECONNRESET") &&
                    connectAttemptCount < maxRetryAttemptCount
                ) {
                    isRetrying = true;
                    setTimeout(connect, retryDurationMs);
                    return;
                }

                // eslint-disable-next-line no-console
                console.error("Failed to connect to proxied WebSocket server:", error);

                proxySocket.close(1011);
            });

            socket.on("message", (rawData, isBinary) => {
                if (isRetrying) return;

                const data = isBinary ? rawData : rawData.toString();

                if (proxySocket.readyState === WebSocket.OPEN) {
                    proxySocket.send(data);
                }
            });

            socket.on("close", (code, reason) => {
                if (isRetrying) return;

                if (code === 1005 || code === 1006) code = 1011;

                if (proxySocket.readyState === WebSocket.OPEN) {
                    proxySocket.close(code, reason);
                }
            });
        }
    });

    await new Promise<void>(resolve => {
        proxyServer.listen(port1, resolve);
    });
}
