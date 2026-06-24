import {FileProcessorServiceSecretsSchema} from "~/server/aws/file_processor_service_secrets_schema.js";
import {processFile} from "~/server/files/processor/process_file.js";
import {
    ProcessFileHeavyJobDescription,
    ProcessFileLightJobDescription,
} from "~/server/jobs/core/job_description.js";
import {
    LambdaSystemActionContext,
    createLambdaJobQueueConsumerHandler,
} from "~/server/lambda/create_lambda_job_queue_consumer_handler.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

const temporaryDirectoryPath = "/tmp";

export const handler = createLambdaJobQueueConsumerHandler({
    processJob: processFileJob,
    serviceName: "FileProcessorService",
    serviceSecretsSchema: FileProcessorServiceSecretsSchema,
    honeycombDataset: "tracer",
});

/**
 * Process a single SQS record using the same logic as the ECS service.
 */
export async function processFileJob(
    context: LambdaSystemActionContext,
    job: ProcessFileLightJobDescription | ProcessFileHeavyJobDescription,
    jobStartTime: Date,
    span: TracerSpan,
): Promise<void> {
    void jobStartTime;
    span.addData({file: {jobReason: job.reason, jobType: job.type}});
    await processFile(context, span, {
        spaceId: job.spaceId,
        fileId: job.fileId,
        contentType: job.contentType,
        temporaryDirectoryPath,
    });
}
