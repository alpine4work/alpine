import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getInboxEntryForAccount} from "~/server/notifications/data/get_inbox_entry_for_account.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {InboxEntryKey, InboxEntryModel} from "~/shared/notifications/inbox_model.js";

/**
 * Get a single inbox entry for the actor based on the provided key. Enforces that
 * the actor is a session actor and not a bot, as bots don't have an inbox.
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
    const sessionContext = context.actor.authorizeSession();
    const accountId = sessionContext.actor.getAccountId();

    // Bots don't have an inbox.
    await authorizeNotBotSpaceAccount(sessionContext, spaceId, accountId);

    const item = await getInboxEntryForAccount(sessionContext, {
        spaceId,
        accountId,
        key,
        consistency,
    });

    return item;
}
