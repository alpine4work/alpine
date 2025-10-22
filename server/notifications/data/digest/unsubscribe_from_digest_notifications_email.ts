import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getInitialInboxItem} from "~/server/notifications/data/internal/get_initial_inbox_item.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {authorizeNotBotSpaceAccount, authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

export async function unsubscribeFromDigestNotificationsEmail(
    context: ServerSessionActionContext,
    {
        accountId,
        spaceId,
    }: {
        accountId: AccountId;
        spaceId: SpaceId;
    },
) {
    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    const currentTime = new Date();

    await InboxTable.updateItem(
        context,
        {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId,
            accountId,
        },
        item => {
            item ??= getInitialInboxItem(spaceId, accountId);
            if (item.digestNotificationsOptedOutTime !== null) return item;
            return {
                ...item,
                digestNotificationsOptedOutTime: currentTime,
            };
        },
    );
}
