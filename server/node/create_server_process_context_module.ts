import {ShutdownManagerBase} from "~/server/node/shutdown_manager.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

export function createServerProcessContextModule({
    tracer,
    shutdownManager,
}: {
    tracer: TracerRoot;
    shutdownManager: ShutdownManagerBase;
}) {
    return new ProcessContextModule({
        waitUntil: promise => {
            shutdownManager.registerWaitUntilPromise(
                promise.catch(error => {
                    tracer.logUncaughtException("Uncaught exception from `waitUntil()`", error);
                }),
            );
        },
    });
}
