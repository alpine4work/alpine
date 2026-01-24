import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {PendingSubtleNotificationsIndex} from "~/server/notifications/data/internal/notifications_table.js";
import {Context} from "~/shared/context/context.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";

export async function sendAllPendingSubtleNotifications(
    context: Context<{jobs: JobsContextModule} & Omit<ServerActionContextModules, "actor">>,
    {sendTime = new Date()}: {sendTime?: Date},
) {
    const allAccountsWithPendingSubtleNotifications = PendingSubtleNotificationsIndex.query(
        context,
        {
            partitionKey: {hasPendingSubtleNotifications: true},
            limit: "All",
        },
    );

    await parallelMapAsyncIterableToArray(allAccountsWithPendingSubtleNotifications, async item => {
        await context.jobs.sendAndWait({
            type: "SendPendingSubtleNotificationsForInbox",
            accountId: item.accountId,
            spaceId: item.spaceId,
            sendTime,
        });
    });
}
