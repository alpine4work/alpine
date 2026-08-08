import {defaultProvider} from "@aws-sdk/credential-provider-node";
import os from "os";
import {
    createServiceCloudflareR2ContextModule,
    serviceCloudflareR2Options,
} from "~/server/cloudflare/r2/create_service_cloudflare_r2_context_module.js";
import {FilesContextModule} from "~/server/context/files_context_module.js";
import {FileProcessorProcessContext} from "~/server/files/data/file_processor_context.js";
import {createFileProcessorServiceServer} from "~/server/files/processor/file_processor_service_server.js";
import {processFile} from "~/server/files/processor/process_file.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {waitForHttpServer} from "~/server/helpers/node/wait_for_http_server.js";
import {JobQueueConsumer} from "~/server/jobs/queue/consumer/job_queue_consumer.js";
import {createLanguageModelsContextModuleForProcess} from "~/server/language_models/create_language_models_context_module_for_process.js";
import {
    createServerBasicProcessContextModules,
    serverBasicProcessContextOptions,
} from "~/server/node/create_server_basic_process_context_modules.js";
import {
    createServiceTokenAgent,
    serviceTokenAgentOptions,
} from "~/server/node/create_service_token_agent.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {Context} from "~/shared/context/context.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {omitObject} from "~/shared/helpers/object/omit_object.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

type Options = ServiceOptions<typeof options>;

export const options = {
    port: {type: "string"},
    temporaryDirectoryPath: {type: "string"},
    // Used to test LLM calls against real AWS Bedrock in development. Optional.
    awsBedrockTokenForDevelopment: {type: "string", optional: true},
    ...serviceTokenAgentOptions,
    ...serverBasicProcessContextOptions,
    ...omitObject(serviceCloudflareR2Options, ["fileProcessorServiceUrl"]),
} as const;

export async function run({
    options,
    tracer,
    startupSpan,
    shutdownManager,
}: {
    options: Options;
    tracer: TracerRoot;
    startupSpan: TracerSpan;
    shutdownManager: ShutdownManager;
}) {
    const port = options.port ? parseInt(options.port, 10) : null;
    if (!port || !Number.isInteger(port))
        throw new InternalError("`port` integer option is required");

    const jobQueueUrl = assertExists(
        options.fileProcessorJobQueueUrl,
        "Missing `fileProcessorJobQueueUrl` option",
    );

    // In development, wait for our local SQS server to start before starting the
    // `JobQueueService`.
    {
        const parsedJobQueueUrl = new URL(jobQueueUrl);
        if (parsedJobQueueUrl.hostname === "localhost") {
            await waitForHttpServer(parseInt(parsedJobQueueUrl.port, 10));
        }
    }

    const awsSigner = new AwsRequestSigner(defaultProvider());
    void awsSigner.prefetchState(startupSpan);

    const tokenAgent = await createServiceTokenAgent({
        serviceName: "FileProcessorService",
        options,
    });

    assert(
        options.awsBedrockTokenForDevelopment === undefined ||
            process.env.NODE_ENV !== "production",
        "`awsBedrockTokenForDevelopment` must not be set in production",
    );

    const processContext: FileProcessorProcessContext = Context.new({
        ...createServerBasicProcessContextModules({
            tracer,
            shutdownManager,
            awsSigner,
            options,
        }),
        r2: createServiceCloudflareR2ContextModule({
            ...options,
            fileProcessorServiceUrl: `http://localhost:${port}`,
        }),
        files: new FilesContextModule({
            tokenAgent: tokenAgent,
            resourceServiceUrl: assertExists(
                options.resourceServiceUrl,
                "`resourceServiceUrl` option is required",
            ),
        }),
        languageModels: createLanguageModelsContextModuleForProcess({
            awsBedrockTokenForDevelopment: options.awsBedrockTokenForDevelopment,
        }),
    });

    const temporaryDirectoryPath = assertExists(
        options.temporaryDirectoryPath,
        "`temporaryDirectoryPath` option is required",
    );

    const consumer = JobQueueConsumer.start(processContext, {
        region: "us-east-1",
        queueName: "FileProcessor",
        queueUrl: jobQueueUrl,

        // Allow processing at most 1 file per machine core at a time. Our processors are
        // CPU-bound and will use at least 1 CPU at a time. Some processors may use more
        // (for example FFmpeg video transcoding, see `-threads` option for FFmpeg's
        // maximum thread usage).
        //
        // `FileProcessorService` only runs one Node.js process (`withoutCluster: true` is
        // set on our `runService()` call). Since we don't do CPU intensive work in
        // Node.js. Instead Node.js orchestrates other tools for processing files.
        maxFiberCount: process.env.NODE_ENV !== "production" ? 1 : os.cpus().length,
        maxFiberMessageCount: 1,

        processJob: (actionContext, job, jobStartTime, span) => {
            return processFile(actionContext, span, {
                spaceId: job.spaceId,
                fileId: job.fileId,
                contentType: job.contentType,
                temporaryDirectoryPath,
            });
        },
    });

    shutdownManager.registerListenerForIngressTraffic("Stopping job queue consumer", async () => {
        await consumer.stop();
    });

    const server = createFileProcessorServiceServer(processContext, {
        shutdownManager,
        tokenAgent,
        temporaryDirectoryPath,
        withFiber: consumer.withFiber,
    });

    server.listen(port, () => {
        // Log when ready in production to help when debugging container startup.
        if (process.env.NODE_ENV === "production") {
            // eslint-disable-next-line no-console
            console.log(
                `Waiting for jobs from queue and listening on port ${port} (pid ${process.pid})`,
            );
        }
    });
}
