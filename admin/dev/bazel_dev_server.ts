import express from "express";
import {createServer} from "http";
import prettyMs from "pretty-ms";
import {WebSocket, WebSocketServer} from "ws";
import {subscribeToBazelBuildEvents} from "~/admin/dev/bazel/build_bazel_target.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * We run a WebSocket dev server which reports Bazel build status to the client
 * so it can show a "Building" indicator. This dev server has the same protocol
 * as the [dev server Remix used before migrating to Vite][1]. Now that Remix
 * doesn't have its own dev server (and instead uses the Vite dev server) we
 * don't need to speak that protocol anymore.
 *
 * [1]: https://github.com/remix-run/remix/blob/fae7cd1931e21ed1196a1d59bd168cba6898ac78/packages/remix-dev/devServer_unstable/socket.ts#L1
 */
export async function startBazelDevServer({
    port,
    logError,
}: {
    port: number;
    logError: (reason: string, error: unknown) => void;
}) {
    const remixDevServer = express();

    const actualRemixDevServer = createServer();
    actualRemixDevServer.on("request", remixDevServer);

    const remixDevWebSocketServer = new WebSocketServer({
        server: actualRemixDevServer,
    });

    function broadcast(message: unknown) {
        remixDevWebSocketServer.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }

    function log(messageText: string) {
        broadcast({
            type: "LOG",
            message: `[bazel] ${messageText}`,
        });
    }

    function reload() {
        broadcast({type: "RELOAD"});
    }

    const unsubscribe = subscribeToBazelBuildEvents(event => {
        switch (event.type) {
            case "BuildStart": {
                log(`Building ${event.targets.join(" ")}`);
                break;
            }
            case "BuildFinish": {
                if (event.hasFailed) {
                    log(
                        `Failed to build ${event.targets.join(" ")} (${prettyMs(
                            event.durationMs,
                        )})`,
                    );
                } else {
                    log(`Built ${event.targets.join(" ")} (${prettyMs(event.durationMs)})`);
                }
                break;
            }
            default:
                throw exhaustive(event);
        }
    });

    actualRemixDevServer.on("error", error => {
        logError("Uncaught exception from Remix dev server", error);
    });

    remixDevWebSocketServer.on("error", error => {
        logError("Uncaught exception from Remix dev server", error);
    });

    await new Promise<void>(resolve => {
        actualRemixDevServer.listen(port, resolve);
    });

    async function close() {
        unsubscribe();

        await new Promise<void>((resolve, reject) => {
            actualRemixDevServer.close(error => {
                if (error) reject(error);
                else resolve();
            });
        });
    }

    return {
        log,
        reload,
        close,
    };
}
