import express from "express";
import {createServer} from "http";
import prettyMs from "pretty-ms";
import {WebSocket, WebSocketServer} from "ws";
import {subscribeToBazelBuildEvents} from "~/admin/dev/bazel/build_bazel_target.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * We maintain our own Remix dev server which speaks the Remix dev server
 * [WebSocket protocol][1] that works well with our Bazel dev setup.
 *
 * We don't need to call `broadcastDevReady()` because our server has a
 * `dev_proxy_server.ts` in front of it. If the server is not available we will
 * still accept new requests and wait for the server to become available. We
 * can immediately emit reload events as they become available and the browser
 * will wait for the new assets to be ready.
 *
 * [1]: https://github.com/remix-run/remix/blob/fae7cd1931e21ed1196a1d59bd168cba6898ac78/packages/remix-dev/devServer_unstable/socket.ts#L1
 */
export async function startRemixDevServer({remixDevServerPort}: {remixDevServerPort: number}) {
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
            message: `[remix] ${messageText}`,
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
                log(`Built ${event.targets.join(" ")} (${prettyMs(event.durationMs)})`);
                break;
            }
            default:
                throw exhaustive(event);
        }
    });

    actualRemixDevServer.on("error", error => {
        // eslint-disable-next-line no-console
        console.error("Uncaught exception from Remix dev server:", error);
    });

    remixDevWebSocketServer.on("error", error => {
        // eslint-disable-next-line no-console
        console.error("Uncaught exception from Remix dev WebSocket server:", error);
    });

    await new Promise<void>(resolve => {
        actualRemixDevServer.listen(remixDevServerPort, resolve);
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
