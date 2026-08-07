/*
 * NOTE(calebmer, 2023-08-30): Adapted from [Dashlane's blog post on graceful
 * HTTP shutdowns in Node.js][1]. Helps us achieve zero downtime deploys by
 * finishing requests we've already seen before shutting down the process.
 *
 * [1]: https://www.dashlane.com/blog/implementing-nodejs-http-graceful-shutdown
 *
 * Copyright 2020 Dashlane
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Server} from "http";
import {Socket} from "net";
import {httpServerGracefulForceShutdownTimeoutMs} from "~/server/helpers/node/shutdown_timeouts.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {createTimeout} from "~/shared/helpers/async/timeout.open_source.js";

// In cases a client is sending no more requests, we won't have the opportunity to
// send `Connection: close` back In these cases we should just end the connection
// as it has become idle. Note that this could be achieved internally with
// `server.keepAliveTimeout` but the normal runtime value might be different for
// what we'd like here
//
// NOTE(calebmer, 2023-11-07): Wait at least 60s before trying to end idle
// connections. [ALB's idle timeout is 60s][1]. Increased the timeout since we were
// experiencing 502 errors during a deploy. [This blog post][2] claims the fix is
// to wait for ALB to close keep alive connections instead of us prematurely
// closing the connection.
//
// NOTE(calebmer, 2024-09-13): Making this 65 seconds instead of 60 seconds did not
// fix the 502 errors during a deploy. Can change this without fear of breaking
// things.
//
// [1]:
//     https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html#connection-idle-timeout
// [2]:
//     https://www.tessian.com/blog/how-to-fix-http-502-errors/#:~:text=The%20502%20Bad%20Gateway%20error,segment%20to%20the%20ALB%20socket.
const timeoutToTryEndIdleMs = 1000 * 65;

/**
 * Register a shutdown listener for our HTTP server that stops the server from
 * accepting new connections while letting existing requests finish.
 *
 * Implements better handling of keep-alive connections for graceful termination of
 * a server. Calling `server.close()` will stop the server from accepting new
 * connections, but existing keep-alive aren't closed nor handled in any special
 * way by default. https://github.com/nodejs/node/issues/2642 shows that this can
 * keep a server for being shutdown cleanly after serving ongoing requests.
 *
 * This function will keep track of all opened connections and ongoing requests.
 *
 * The main idea is trying to serve all ongoing requests before shutting down the
 * server while trying to minimize the "socket hangup" or "connection reset" errors
 * on clients.
 *
 * Once the server starts being terminated, the server will reply with
 * `Connection: close` headers to signal clients not to send requests on existing
 * connections because they will be closed. This is done to minimize the chance of
 * closing a connection while there is an in-flight request to the server.
 *
 * All connections for which a `Connection: close` response has been sent, will be
 * terminated after handling the last request.
 *
 * After a timeout, all idle connections with no ongoing requests will be closed,
 * even if they haven't received the `Connection: close` header.
 *
 * After a bigger timeout, if some connections are still keeping the server open,
 * all connections will be forced closed and ongoing requests will not send a
 * response.
 */
export function registerGracefulServerShutdown(shutdownManager: ShutdownManager, server: Server) {
    // We need to keep track of requests per connection so that we can detect when we
    // have responded to a request in a keep-alive connection. This is the only way in
    // node that we can close a keep-alive connection after handling requests.
    const reqCountBySocket = new Map<Socket, number>();

    // To minimize the chances of closing a connection while there is a request
    // in-flight from the client we respond with a `Connection: close` header once the
    // server starts being terminated. We'll only immediately close connections where
    // we have responded this header. For others, we'll only close them if they're
    // still open after `timeoutToTryEndIdleMs` This won't help against clients that
    // don't respect the `Connection: close` header
    const hasRepliedClosedConnectionForSockets = new WeakSet<Socket>();

    let isShuttingDown = false;

    server.on("connection", socket => {
        reqCountBySocket.set(socket, 0);
        socket.once("close", () => {
            reqCountBySocket.delete(socket);
        });
    });

    server.on("request", (req, res) => {
        {
            const reqCount = reqCountBySocket.get(req.socket)! + 1;
            reqCountBySocket.set(req.socket, reqCount);
        }

        if (isShuttingDown && !res.headersSent) {
            res.setHeader("connection", "close");
            hasRepliedClosedConnectionForSockets.add(req.socket);
        }

        res.on("finish", () => {
            const reqCount = reqCountBySocket.get(req.socket)! - 1;
            reqCountBySocket.set(req.socket, reqCount);

            if (
                isShuttingDown &&
                reqCount === 0 &&
                hasRepliedClosedConnectionForSockets.has(req.socket)
            ) {
                req.socket.end();
            }
        });
    });

    // Register a listener for the ingress traffic shutdown phase. Database resources
    // and the like should be shutdown after ingress traffic completes.
    shutdownManager.registerListenerForIngressTraffic("Closing HTTP server", async () => {
        isShuttingDown = true;

        const timeout1 = createTimeout(() => {
            for (const [socket, reqCount] of reqCountBySocket) {
                if (reqCount === 0) {
                    socket.end();
                }
            }
        }, timeoutToTryEndIdleMs);

        const timeout2 = createTimeout(() => {
            for (const socket of reqCountBySocket.keys()) {
                socket.end();
            }
        }, httpServerGracefulForceShutdownTimeoutMs);

        await new Promise<void>((resolve, reject) =>
            // callback won't be called as long as there are open connections. So here we're
            // "implicitly" also waiting for the callbacks that will close idle connections or
            // force close all connections after a delay
            server.close(error => {
                if (error) reject(error);
                else resolve();
            }),
        );

        timeout1.clear();
        timeout2.clear();
    });
}
