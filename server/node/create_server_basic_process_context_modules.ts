import {join as joinPath} from "path";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {JobSender} from "~/server/jobs/core/job_sender.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {ShutdownManagerBase} from "~/server/node/shutdown_manager.js";
import {ServerConstantsContextModule} from "~/shared/context/constants_context_module.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

export const serverBasicProcessContextOptions = {
    ensureLocalCachePath: {type: "string"},
    dynamoLocalPort: {type: "string"},
    jobQueueUrl: {type: "string"},
    fileProcessorJobQueueUrl: {type: "string"},
    edgeServiceUrl: {type: "string"},
    // TODO(ifitzsimmons, 2025-07-30, #add-light-and-heavy-queues): These should not be optional
    fileProcessorHeavyJobQueueUrl: {type: "string", optional: true},
    fileProcessorLightJobQueueUrl: {type: "string", optional: true},
} as const;

export type ServerBasicProcessContextOptions = {
    readonly edgeServiceUrl?: string;
    readonly ensureLocalCachePath?: string;
    readonly dynamoLocalPort?: string;
    readonly jobQueueUrl?: string;
    // TODO(ifitzsimmons, 2025-07-30, #file-processor-service-migration): Remove original job queue
    // url
    readonly fileProcessorJobQueueUrl?: string;
    readonly fileProcessorHeavyJobQueueUrl?: string;
    readonly fileProcessorLightJobQueueUrl?: string;
};

/**
 * Create a `ServerProcessContext`. You should run this at the root of your
 * service. Probably in a `runService()` call.
 *
 * Requires some parameters we expect to come from the command line.
 * `serverProcessContextOptions` is an object defining the args you can
 * pass into `parseArgs()`.
 */
export function createServerBasicProcessContextModules({
    tracer,
    shutdownManager,
    awsSigner,
    options,
}: {
    tracer: TracerRoot;
    shutdownManager: ShutdownManagerBase;
    awsSigner: AwsRequestSigner;
    options: ServerBasicProcessContextOptions;
}) {
    return createServerBasicProcessContextModulesWithoutShutdownManager({
        tracer,
        awsSigner,
        options,
        waitUntil: (promise: Promise<unknown>) => {
            shutdownManager.registerWaitUntilPromise(
                promise.catch(error => {
                    tracer.logException("Uncaught exception from `waitUntil()`", error);
                }),
            );
        },
    });
}

export function createServerBasicProcessContextModulesWithoutShutdownManager({
    tracer,
    waitUntil,
    awsSigner,
    options,
}: {
    tracer: TracerRoot;
    waitUntil: (promise: Promise<unknown>) => void;
    awsSigner: AwsRequestSigner;
    options: ServerBasicProcessContextOptions;
}): {
    process: ProcessContextModule;
    tracer: TracerContextModule;
    dynamo: DynamoContextModule;
    jobs: JobsContextModule;
    constants: ServerConstantsContextModule;
} {
    return {
        process: new ProcessContextModule({
            waitUntil,
        }),
        tracer: new TracerContextModule(tracer),
        dynamo: DynamoContextModule.new({
            url:
                process.env.NODE_ENV === "production"
                    ? "https://dynamodb.us-east-1.amazonaws.com"
                    : `http://localhost:${parseInt(
                          assertExists(
                              options.dynamoLocalPort,
                              "`dynamoLocalPort` option is required in development",
                          ),
                          10,
                      )}`,
            signer: awsSigner,
            ensureLocalCachePath:
                process.env.NODE_ENV !== "production"
                    ? joinPath(
                          assertExists(
                              options.ensureLocalCachePath,
                              "`ensureLocalCachePath` option is required in development",
                          ),
                          "dynamo",
                      )
                    : null,
        }),
        jobs: JobsContextModule.new(
            new JobSender({
                region: "us-east-1",
                queueUrl: assertExists(options.jobQueueUrl, "`jobQueueUrl` option is required"),
                fileProcessorQueueUrl: assertExists(
                    options.fileProcessorJobQueueUrl,
                    "`fileProcessorJobQueueUrl` option is required",
                ),
                fileProcessorHeavyQueueUrl: options.fileProcessorHeavyJobQueueUrl,
                fileProcessorLightQueueUrl: options.fileProcessorLightJobQueueUrl,
            }),
        ),
        constants: new ServerConstantsContextModule({
            edgeServiceUrl: assertExists(
                options.edgeServiceUrl,
                "`edgeServiceUrl` option is required",
            ),
        }),
    };
}
