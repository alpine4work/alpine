import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {MaintenanceJobQueueSystemActionContext} from "~/server/jobs/queue/job_queue_system_action_context.js";
import {retryUnprocessedTaskActionTransactions} from "~/server/tasks/data/task_table.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export async function processMaintenanceJob(
    context: MaintenanceJobQueueSystemActionContext,
    job: MaintenanceJobDescription,
    jobStartTime: Date,
    span: TracerSpan,
) {
    // Right now there's only one type of maintenance job. Eventually there will be
    // more and we should rewrite this as an exhaustive switch.
    cast<"RetryUnprocessedTaskActionTransactions">(job.type);

    await retryUnprocessedTaskActionTransactions(context, span);
}
