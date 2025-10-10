import {
    ServerActionContextModules,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {SendNotificationDigestJobDescription} from "~/server/jobs/core/job_description.js";
import {
    sendNotificationDigestForInbox,
    sendScheduledDigestsForTime,
} from "~/server/notifications/data/notifications_actions_digest.js";
import {Context} from "~/shared/context/context.js";

export async function processSendNotificationDigestJob(
    context: Context<ServerSystemActionContextModules & {email: EmailContextModuleBase}>,
    {accountId, spaceId, sendTime}: SendNotificationDigestJobDescription,
) {
    return sendNotificationDigestForInbox(context, sendTime, {accountId, spaceId});
}
export async function processEnqueueScheduledNotificationDigestsJob(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    jobStartTime: Date,
) {
    await sendScheduledDigestsForTime(context, jobStartTime);
}
