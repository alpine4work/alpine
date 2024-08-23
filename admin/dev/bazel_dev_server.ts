import prettyMs from "pretty-ms";
import {WebSocket, WebSocketServer} from "ws";
import {bazelExecutableMutex} from "~/admin/dev/bazel/bazel_executable.js";
import {subscribeToBazelBuildEvents} from "~/admin/dev/bazel/build_bazel_target.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
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

    bazelDevServer.on("connection", socket => {
        let lockPromise: Promise<() => void> | null = null;

        socket.on("error", error => {
            if (lockPromise !== null) {
                lockPromise.then(unlock => unlock()).catch(scheduleUncaughtError);
                lockPromise = null;
            }

            logError("Uncaught exception from Bazel dev server connection", error);
        });

        socket.on("close", () => {
            if (lockPromise !== null) {
                lockPromise.then(unlock => unlock()).catch(scheduleUncaughtError);
                lockPromise = null;
            }
        });

        socket.on("message", rawMessage => {
            const message: {type: "AcquireLock"} | {type: "ReleaseLock"} = JSON.parse(
                rawMessage.toString("utf8"),
            );

            switch (message.type) {
                case "AcquireLock": {
                    if (lockPromise === null) {
                        lockPromise = bazelExecutableMutex.lock();
                    }

                    lockPromise
                        .then(() => socket.send(JSON.stringify({type: "LockAcquired"})))
                        .catch(scheduleUncaughtError);
                    break;
                }
                case "ReleaseLock": {
                    if (lockPromise !== null) {
                        lockPromise.then(unlock => unlock()).catch(scheduleUncaughtError);
                        lockPromise = null;
                    }
                    break;
                }
                default:
                    throw exhaustive(message);
            }
        });
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
