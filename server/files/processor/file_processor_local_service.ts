import {defaultProvider} from "@aws-sdk/credential-provider-node";
import {startLambdaLocal} from "~/admin/lambda/local/start_lambda_local.js";
import {handleInternalMiniflareGetObject} from "~/server/files/processor/file_processor_service_server.js";
import {processFileJob} from "~/server/files/processor/process_file/process_file_lambda.js";
import {processFile} from "~/server/files/processor/process_file.js";
import {handleResizeAvatarRequest} from "~/server/files/processor/resize_avatar/handle_resize_avatar_request.js";
import {handleResizeFileRequest} from "~/server/files/processor/resize_file/handle_resize_file_request.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {ProcessFileJobDescription} from "~/server/jobs/core/job_description.js";
import {LambdaSystemActionContext} from "~/server/lambda/create_lambda_job_queue_consumer_handler.js";
import {
    createLambdaActionContext,
    lambdaActionContextOptions,
} from "~/server/lambda/helpers/lambda_action_context.js";
import {createServiceTokenAgent} from "~/server/node/create_service_token_agent.js";
import {ServiceOptions} from "~/server/node/run_service.js";
import {ShutdownManager} from "~/server/node/shutdown_manager.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

type Options = ServiceOptions<typeof options>;

export const options = {
    port: {type: "string"},
    ...lambdaActionContextOptions,
    honeycombApiKey: {type: "string", optional: true},
    sqsLocalPort: {type: "string"},
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
    const port = assertExists(options.port, "`port` option is required");
    const sqsLocalPort = assertExists(options.sqsLocalPort, "`sqsLocalPort` option is required");
    const fileProcessorServiceUrl = `http://localhost:${port}`;

    const tokenAgent = await createServiceTokenAgent({
        serviceName: "FileProcessorService",
        options,
    });

    const awsSigner = new AwsRequestSigner(defaultProvider());
    void awsSigner.prefetchState(startupSpan);

    const promiseWaiter = new PromiseWaiter();
    const actionContext = createLambdaActionContext({
        options,
        awsSigner,
        tokenAgent,
        tracer,
        promiseWaiter,
        fileProcessorServiceUrl,
    });

    shutdownManager.registerWaitUntilPromise(promiseWaiter.wait());

    startLambdaLocal(actionContext, shutdownManager, tokenAgent, parseInt(port, 10), {
        routes: [
            {
                path: "/{spaceId}/resize/{fileId}",
                handler: handleResizeFileRequest,
                functionName: "ResizeFile",
                timeoutMs: 30000, // 30 seconds
            },
            {
                path: "/avatar",
                handler: handleResizeAvatarRequest,
                functionName: "CreateAvatar",
                timeoutMs: 30000, // 30 seconds
            },
            {
                path: "/internal/miniflare/get-object/{bucket}/{key}",
                handler: (processContext, {request, url}) => {
                    const pathnameParts = url.pathname.slice(1).split("/");
                    if (
                        pathnameParts.length === 5 &&
                        pathnameParts[0] === "internal" &&
                        pathnameParts[1] === "miniflare" &&
                        pathnameParts[2] === "get-object"
                    ) {
                        const bucketName = pathnameParts[3]!;
                        const key = decodeURIComponent(pathnameParts[4]!);

                        return handleInternalMiniflareGetObject(processContext, {
                            request,
                            url,
                            bucketName,
                            key,
                        });
                    } else {
                        throw new InternalError("Invalid request path");
                    }
                },
                functionName: "InternalMiniflareGetObject",
                timeoutMs: 30000, // 30 seconds
            },
        ],
        subscribers: [
            // TODO(ifitzsimmons, #file-processor-service-migration) Remove when we migrate
            {
                sqs: {
                    endpoint: `http://localhost:${sqsLocalPort}`,
                    region: "us-east-1",
                    queueUrl: assertExists(options.fileProcessorJobQueueUrl),
                    queueName: "FileProcessor",
                },
                // NOTE(ifitzsimmons, 09-16-2025) The `handler` function is generic and the
                // typing should work here. For whatever reason, TS is having a hard time
                // understanding that the FileProcessorJob correctly extends our valid job types.
                // @ts-expect-error
                handler: (
                    processContext: LambdaSystemActionContext,
                    job: ProcessFileJobDescription,
                    jobStartTime: Date,
                    span: TracerSpan,
                ) =>
                    processFile(processContext, span, {
                        spaceId: job.spaceId,
                        fileId: job.fileId,
                        contentType: job.contentType,
                        temporaryDirectoryPath: assertExists(options.temporaryDirectoryPath),
                    }),
                functionName: "FileProcessor",
                timeoutMs: 1000 * 60 * 5, // 5 minutes
            },
            {
                sqs: {
                    endpoint: `http://localhost:${sqsLocalPort}`,
                    region: "us-east-1",
                    queueUrl: assertExists(options.fileProcessorHeavyJobQueueUrl),
                    queueName: "FileProcessorHeavy",
                },
                // NOTE(ifitzsimmons, 09-03-2025) The `handler` function is generic and the
                // typing should work here. For whatever reason, TS is having a hard time
                // understanding that the FileProcessorJob correctly extends our valid job types.
                // @ts-expect-error
                handler: processFileJob,
                functionName: "FileProcessorHeavy",
                timeoutMs: 1000 * 60 * 5, // 5 minutes
            },
            {
                sqs: {
                    endpoint: `http://localhost:${sqsLocalPort}`,
                    region: "us-east-1",
                    queueUrl: assertExists(options.fileProcessorLightJobQueueUrl),
                    queueName: "FileProcessorLight",
                },
                // NOTE(ifitzsimmons, 09-03-2025) The `handler` function is generic and the
                // typing should work here. For whatever reason, TS is having a hard time
                // understanding that the FileProcessorJob correctly extends our valid job types.
                // @ts-expect-error
                handler: processFileJob,
                functionName: "FileProcessorLight",
                timeoutMs: 1000 * 60 * 5, // 5 minutes
            },
        ],
    });
}
