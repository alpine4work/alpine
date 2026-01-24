import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {getInitialInboxItem} from "~/server/notifications/data/internal/get_initial_inbox_item.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {observeInboxItem} from "~/server/notifications/data/internal/observe_inbox_item.js";
import {clearPendingSubtleNotificationsForInbox} from "~/server/notifications/data/internal/push/clear_pending_subtle_notifications_for_inbox.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Mark the current account's inbox as observed. Any loud notifications will
 * freeze in place at this point.
 */
// TODO(calebmer): It's a little weird that we observe the inbox only when it
// opens. That means inbox entries accumulate as if the inbox is unobserved
// while the user is staring it in realtime. We should probably change this to
// a model of "user is observing" and if the user is observing we increment the
// inbox generation on basically every update. This means new inbox entries
// will be directly added to the top of the inbox while the user is actively
// observing.
export async function observeInbox(
    context: ServerSessionActionContext,
    {spaceId}: {spaceId: SpaceId},
): Promise<void> {
    const accountId = context.actor.getAccountId();

    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots don't have an inbox.
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    await runAllPromises([
        clearPendingSubtleNotificationsForInbox(context, {accountId, spaceId}),
        InboxTable.updateItem(
            context,
            {
                partitionType: "Account",
                sortRangeType: "InboxAttributes",
                spaceId,
                accountId,
            },
            item => {
                item ??= DynamoItem.create(getInitialInboxItem(spaceId, accountId));
                return observeInboxItem(item);
            },
        ),
    ]);
}
