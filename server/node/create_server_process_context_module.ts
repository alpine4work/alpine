import {registerShutdownWaitUntilPromise} from "~/server/node/shutdown_manager.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

export function createServerProcessContextModule(tracer: TracerRoot) {
    return new ProcessContextModule({
        waitUntil: promise => {
            registerShutdownWaitUntilPromise(
                promise.catch(error => {
                    tracer.logUncaughtException("Uncaught exception from `waitUntil()`", error);
                }),
            );
        },
    });
}
