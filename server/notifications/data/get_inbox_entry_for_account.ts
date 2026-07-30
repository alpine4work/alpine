import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeInboxAccessForAccount} from "~/server/notifications/data/authorize_inbox_access_for_account.js";
import {getInboxEntryItemKey} from "~/server/notifications/data/internal/get_inbox_entry_item_key.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {InboxEntryKey, InboxEntryModel} from "~/shared/notifications/inbox_model.js";

/**
 * Get a single entry for `accountId`'s inbox in `spaceId`. Authorization is via
 * `authorizeInboxAccessForAccount()`, so this works for any actor type that could
 * have access to read the inbox (session, impersonated, bot, or system).
 */
export async function getInboxEntryForAccount(
    context: ServerActionContext,
    {
        spaceId,
        accountId,
        key,
        consistency,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        key: InboxEntryKey;
        consistency?: DynamoReadConsistency;
    },
): Promise<RynamoItem<InboxEntryModel>> {
    await authorizeInboxAccessForAccount(context, {
        spaceId,
        accountId,
        expectedAccessLevel: "View",
    });

    const item = await InboxTable.getRealtimeItem(
        context,
        getInboxEntryItemKey({spaceId, accountId, key}),
        {consistency},
    );

    return item;
}
