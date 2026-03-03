import {WebSocket, WebSocketServer} from "ws";
import {subscribeToBazelBuildEvents} from "~/admin/dev/bazel/build_bazel_target.js";

/**
 * We run a WebSocket dev server which reports Bazel build status so we can show a
 * "Building" indicator on the client.
 */
export async function startBazelDevServer({
    port,
    logError,
}: {
    port: number;
    logError: (reason: string, error: unknown) => void;
}) {
    const bazelDevServer = new WebSocketServer({port});

    function broadcast(message: unknown) {
        bazelDevServer.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(message));
            }
        });
    }

    const unsubscribe = subscribeToBazelBuildEvents(event => {
        broadcast({type: "Bazel", event});
    });

    bazelDevServer.on("error", error => {
        logError("Uncaught exception from Bazel dev server", error);
    });

    await new Promise<void>(resolve => {
        bazelDevServer.on("listening", resolve);
    });

    async function close() {
        unsubscribe();

        await new Promise<void>((resolve, reject) => {
            bazelDevServer.close(error => {
                if (error) reject(error);
                else resolve();
            });
        });
    }

    return {
        reload: () => broadcast({type: "Reload"}),
        close,
    };
}
