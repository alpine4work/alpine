import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getInboxEntryItemKey} from "~/server/notifications/data/internal/get_inbox_entry_item_key.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxEntryKey, InboxEntryModel} from "~/shared/notifications/inbox_model.js";

/**
 * Get a single inbox for the actor based on the provided key.
 */
export async function getInboxEntry(
    context: ServerSessionActionContext,
    {
        spaceId,
        key,
        consistency,
    }: {
        spaceId: SpaceId;
        key: InboxEntryKey;
        consistency?: DynamoReadConsistency;
    },
): Promise<RynamoItem<InboxEntryModel>> {
    const accountId = context.actor.getAccountId();

    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots don't have an inbox.
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    const item = await InboxTable.getRealtimeItem(
        context,
        getInboxEntryItemKey({spaceId, accountId, key}),
        {consistency},
    );

    return item;
}
