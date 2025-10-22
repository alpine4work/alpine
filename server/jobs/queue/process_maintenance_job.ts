import {scheduleDeploy} from "~/server/deploy/data/deploy_actions.js";
import {processSendEmail} from "~/server/emails/process_send_email.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {MaintenanceJobQueueSystemActionContext} from "~/server/jobs/queue/job_queue_service_context.js";
import {processEnqueueScheduledNotificationDigestsJob} from "~/server/notifications/data/digest/notifications_digest_jobs.js";
import {retryUnprocessedTaskActionTransactions} from "~/server/tasks/data/task_table.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export async function processMaintenanceJob(
    context: MaintenanceJobQueueSystemActionContext,
    job: MaintenanceJobDescription,
    jobStartTime: Date,
    span: TracerSpan,
) {
    switch (job.type) {
        case "ScheduleDeploy": {
            await scheduleDeploy(context, span, job);
            break;
        }
        case "RetryUnprocessedTaskActionTransactions": {
            await retryUnprocessedTaskActionTransactions(context, span);
            break;
        }
        case "SendEmail": {
            await processSendEmail(context, job);
            break;
        }
        case "EnqueueScheduledNotificationDigests": {
            await processEnqueueScheduledNotificationDigestsJob(context, jobStartTime);
            break;
        }
    }
}
