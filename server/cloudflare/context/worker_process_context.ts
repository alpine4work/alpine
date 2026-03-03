import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

/**
 * Generic context for code running at the process level of our app service outside
 * of the scope of an individual request. Individual requests should use a
 * `WorkerActionContext`.
 */
export type WorkerProcessContext = Context<WorkerProcessContextModules>;

export type WorkerProcessContextModules = {
    process: ProcessContextModule;
    tracer: TracerContextModule;
};
