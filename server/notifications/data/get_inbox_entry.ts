import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getInboxEntryItemKey} from "~/server/notifications/data/internal/get_inbox_entry_item_key.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {authorizeNotBotSpaceAccount, authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
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
): Promise<DynamoGeneralRealtimeItem<InboxEntryModel>> {
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
