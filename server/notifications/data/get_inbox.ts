import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getInboxForAccount} from "~/server/notifications/data/get_inbox_for_account.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";

/**
 * Get the session account's inbox in the provided space. Thin shim over
 * `getInboxForAccount()`.
 */
export async function getInbox(
    context: ServerSessionActionContext,
    {
        spaceId,
        consistency = "Eventual",
    }: {
        spaceId: SpaceId;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<RynamoItem<InboxModel>> {
    const sessionContext = context.actor.authorizeSession();

    const accountId = sessionContext.actor.getAccountId();

    // Bots don't have an inbox.
    await authorizeNotBotSpaceAccount(sessionContext, spaceId, accountId);

    return await getInboxForAccount(sessionContext, {
        spaceId,
        accountId,
        consistency,
    });
}
