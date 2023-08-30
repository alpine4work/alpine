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
import {registerShutdownListenerForIngressTraffic} from "~/server/node/shutdown_manager.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {wait} from "~/shared/helpers/async/wait.js";

// If the server needs to be stopped and it seems to be having trouble keeping
// up with pending requests we should just force the closing of the connections
const forcedStopTimeout = 1000 * 60;

// In cases a client is sending no more requests, we won't have the opportunity
// to send `Connection: close` back In these cases we should just end the
// connection as it has become idle. Note that this could be achieved
// internally with `server.keepAliveTimeout` but the normal runtime value might
// be different for what we'd like here
const timeoutToTryEndIdle = 1000 * 15;

/**
 * Register a shutdown listener for our HTTP server that stops the server from
 * accepting new connections while letting existing requests finish.
 *
 * Implements better handling of keep-alive connections for graceful
 * termination of a server. Calling `server.close()` will stop the server
 * from accepting new connections, but existing keep-alive aren't closed nor handled
 * in any special way by default. https://github.com/nodejs/node/issues/2642 shows
 * that this can keep a server for being shutdown cleanly after serving ongoing requests.
 *
 * This function will keep track of all opened connections and ongoing requests.
 *
 * The main idea is trying to serve all ongoing requests before shutting down the
 * server while trying to minimize the "socket hangup" or "connection reset"
 * errors on clients.
 *
 * Once the server starts being terminated, the server will reply with
 * `Connection: close` headers to signal clients not to send requests on existing
 * connections because they will be closed. This is done to minimize the chance
 * of closing a connection while there is an in-flight request to the server.
 *
 * All connections for which a `Connection: close` response has been sent, will be
 * terminated after handling the last request.
 *
 * After a timeout, all idle connections with no ongoing requests will be closed,
 * even if they haven't received the `Connection: close` header.
 *
 * After a bigger timeout, if some connections are still keeping the server
 * open, all connections will be forced closed and ongoing requests will not
 * send a response.
 */
export function registerGracefulServerShutdown(server: Server) {
    // We need to keep track of requests per connection so that we can detect when
    // we have responded to a request in a keep-alive connection. This is the only
    // way in node that we can close a keep-alive connection after handling
    // requests.
    const reqCountBySocket = new Map<Socket, number>();

    // To minimize the chances of closing a connection while there is a request
    // in-flight from the client we respond with a `Connection: close` header once
    // the server starts being terminated. We'll only immediately close connections
    // where we have responded this header. For others, we'll only close them if
    // they're still open after `timeoutToTryEndIdle` This won't help against
    // clients that don't respect the `Connection: close` header
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

    // Register a listener for the ingress traffic shutdown phase. Database
    // resources and the like should be shutdown after ingress traffic completes.
    registerShutdownListenerForIngressTraffic(async () => {
        isShuttingDown = true;

        await runAllPromises([
            new Promise<void>((resolve, reject) =>
                server.close(error => {
                    if (error) reject(error);
                    else resolve();
                }),
            ),
            wait(timeoutToTryEndIdle).then(() => {
                for (const [socket, reqCount] of reqCountBySocket) {
                    if (reqCount === 0) {
                        socket.end();
                    }
                }
            }),
            wait(forcedStopTimeout).then(() => {
                for (const socket of reqCountBySocket.keys()) {
                    socket.end();
                }
            }),
        ]);
    });
}
