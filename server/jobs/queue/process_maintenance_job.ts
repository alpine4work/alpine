import {attemptStartDeploy} from "~/server/deploy/data/deploy_table.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {MaintenanceJobQueueSystemActionContext} from "~/server/jobs/queue/job_queue_system_action_context.js";
import {retryUnprocessedTaskActionTransactions} from "~/server/tasks/data/task_table.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export async function processMaintenanceJob(
    context: MaintenanceJobQueueSystemActionContext,
    job: MaintenanceJobDescription,
    jobStartTime: Date,
    span: TracerSpan,
) {
    switch (job.type) {
        case "AttemptStartDeploy": {
            await attemptStartDeploy(context);
            break;
        }
        case "RetryUnprocessedTaskActionTransactions": {
            await retryUnprocessedTaskActionTransactions(context, span);
            break;
        }
    }
}
