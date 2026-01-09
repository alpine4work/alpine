import {JobQueueMessageBody} from "~/server/jobs/core/job_sender.js";

export function getJobQueueConsumerHandleSpanName(messageBody: JobQueueMessageBody): string {
    let handleSpanName = `${
        messageBody.type === "Maintenance" ? "Process maintenance job" : "Process job"
    } ${messageBody.job.type}`;

    // For jobs that process many different things, include the subtype in the
    // name to help identify the span.
    switch (messageBody.job.type) {
        case "NotificationEvent": {
            handleSpanName += ` (${messageBody.job.event.type})`;
            break;
        }
        case "IndexSearchEntity":
        case "IndexSearchEntityDependents": {
            handleSpanName += ` (${messageBody.job.update.type})`;
            break;
        }
        case "IndexSearchEntityEmbeddingChunks": {
            handleSpanName += ` (${messageBody.job.entityId.split(":", 2)[0]})`;
            break;
        }
        case "ProcessFile":
        case "ProcessFileHeavy":
        case "ProcessFileLight": {
            handleSpanName += ` (${messageBody.job.contentType})`;
            break;
        }
        case "CallBotWebhook": {
            handleSpanName += ` (${messageBody.job.event.type})`;
            break;
        }
        case "SendEmail": {
            handleSpanName += ` (${messageBody.job.fromEmailAddress})`;
            break;
        }
    }

    return handleSpanName;
}
