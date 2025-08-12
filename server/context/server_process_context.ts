import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {ServerConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";

/**
 * Generic context for code running at the process level outside of the scope
 * of an individual request. Individual requests should use a
 * `ServerActionContext`.
 *
 * Since this is a shared type across all our services anything we provide
 * access to here must be critical for the operation of every service. For
 * example, OpenSearch is only used by the search product and the task product.
 * `FileProcessorService` doesn't need OpenSearch so it's not included here.
 */
export type ServerProcessContext = Context<ServerProcessContextModules>;

export type ServerProcessContextModules = {
    /**
     * Interact with process state.
     *
     * For example, register promises that must be resolved by the time the server
     * shuts down.
     */
    process: ProcessContextModule;

    /**
     * Report information to our telemetry provider (Honeycomb).
     */
    tracer: TracerContextModule;

    /**
     * Read and write data in DynamoDB.
     *
     * DynamoDB is the source of truth for basically all data across our system. We
     * have other storage providers for specific use cases. Like OpenSearch which
     * provide an easier-to-query view of data in DynamoDB or Cloudflare R2 that
     * stores large objects. But basically all features need access to DynamoDB so
     * it's considered a critical dependency.
     */
    dynamo: DynamoContextModule;

    /**
     * Send jobs to our job queue.
     *
     * The job queue allows us to process work in the background. Since background
     * processing is a core capability needed by most services we consider the job
     * queue a critical dependency.
     */
    jobs: JobsContextModule;

    /**
     * Access non-sensitive server-wide immutable constants.
     *
     * This is used for sharing constants that are relevant to multiple services during
     * runtime and may vary by environment. This *should not* be used to store
     * secrets or other sensitive information!
     */
    constants: ServerConstantsContextModule;
};
