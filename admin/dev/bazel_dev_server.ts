import prettyMs from "pretty-ms";
import {WebSocket, WebSocketServer} from "ws";
import {subscribeToBazelBuildEvents} from "~/admin/dev/bazel/build_bazel_target.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * We run a WebSocket dev server which reports Bazel build status so we can
 * show a "Building" indicator on the client.
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

    function log(message: string) {
        broadcast({type: "Log", message});
    }

    function reload() {
        broadcast({type: "Reload"});
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
        log,
        reload,
        close,
    };
}
