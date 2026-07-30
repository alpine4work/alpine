import {
    ServerActionContextModules,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {SendNotificationDigestJobDescription} from "~/server/jobs/core/job_description.js";
import {sendNotificationDigestForInbox} from "~/server/notifications/data/digest/send_notification_digest_for_inbox.js";
import {sendScheduledDigestsForTime} from "~/server/notifications/data/digest/send_scheduled_digests_for_time.js";
import {Context} from "~/shared/context/context.js";

export async function processSendNotificationDigestJob(
    context: Context<ServerSystemActionContextModules & {email: EmailContextModuleBase}>,
    {accountId, spaceId, sendTime}: SendNotificationDigestJobDescription,
) {
    return await sendNotificationDigestForInbox(context, sendTime, {accountId, spaceId});
}

export async function processEnqueueScheduledNotificationDigestsJob(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    jobStartTime: Date,
) {
    await sendScheduledDigestsForTime(context, jobStartTime);
}
