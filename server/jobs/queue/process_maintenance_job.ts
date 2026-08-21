import {processSendTryOnDesktopEmail} from "~/server/accounts/process_send_try_on_desktop_email.js";
import {processRemoveAllSpaceAccountsForBotJob} from "~/server/bots/with_spaces/process_remove_all_space_accounts_for_bot_job.js";
import {processUpdateBotAccountsJob} from "~/server/bots/with_spaces/process_update_bot_accounts_job.js";
import {scheduleDeploy} from "~/server/deploy/data/deploy_actions.js";
import {processSendEmail} from "~/server/emails/process_send_email.js";
import {MaintenanceJobDescription} from "~/server/jobs/core/maintenance_job_description.js";
import {MaintenanceJobQueueSystemActionContext} from "~/server/jobs/queue/job_queue_service_context.js";
import {processEnqueueScheduledNotificationDigestsJob} from "~/server/notifications/data/digest/notifications_digest_jobs.js";
import {processSendAllPendingSubtleNotificationsJob} from "~/server/notifications/data/push/notifications_push_jobs.js";
import {retryUnprocessedTaskActionTransactions} from "~/server/tasks/data/retry_unprocessed_task_action_transactions.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export async function processMaintenanceJob(
    context: MaintenanceJobQueueSystemActionContext,
    job: MaintenanceJobDescription,
    jobStartTime: Date,
    span: TracerSpan,
) {
    switch (job.type) {
        case "ScheduleDeploy": {
            await scheduleDeploy(context, span, job);
            return;
        }
        case "RetryUnprocessedTaskActionTransactions": {
            await retryUnprocessedTaskActionTransactions(context, span);
            return;
        }
        case "SendEmail": {
            await processSendEmail(context, job);
            return;
        }
        case "EnqueueScheduledNotificationDigests": {
            await processEnqueueScheduledNotificationDigestsJob(context, jobStartTime);
            return;
        }
        case "UpdateBotAccounts": {
            await processUpdateBotAccountsJob(context, job);
            return;
        }
        case "RemoveBotAccounts": {
            await processRemoveAllSpaceAccountsForBotJob(context, job);
            return;
        }
        case "SendTryOnDesktopEmail": {
            await processSendTryOnDesktopEmail(context, job);
            return;
        }
        case "SendAllPendingSubtleNotifications": {
            await processSendAllPendingSubtleNotificationsJob(context, jobStartTime);
            return;
        }
        case "CreateLoopContact": {
            await context.loops.createContact(job);
            return;
        }
        default: {
            throw exhaustive(job);
        }
    }
}
