import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeInboxAccessForAccount} from "~/server/notifications/data/authorize_inbox_access_for_account.js";
import {getInitialInboxItem} from "~/server/notifications/data/internal/get_initial_inbox_item.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";

/**
 * Get the inbox attributes item for `accountId` in `spaceId`, creating it if
 * missing.
 *
 * Authorization is via `authorizeInboxAccessForAccount()`, so this works for any
 * actor type that has access to read the inbox (session, impersonated, bot, or
 * system).
 */
export async function getInboxForAccount(
    context: ServerAuthenticatedActionContext,
    {
        spaceId,
        accountId,
        consistency = "Eventual",
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<RynamoItem<InboxModel>> {
    await authorizeInboxAccessForAccount(
        context,
        {spaceId, accountId, expectedAccessLevel: "View"},
        {consistency},
    );

    return await context.dynamo.retryTransaction(async context => {
        const inbox = await InboxTable.getRealtimeItemIfExists(
            context,
            {
                partitionType: "Account",
                sortRangeType: "InboxAttributes",
                spaceId,
                accountId,
            },
            {consistency},
        );
        if (inbox) return inbox;

        // If the inbox item doesn't exist yet, let's create one.
        const {getEvent} = await InboxTable.createItem(
            context,
            getInitialInboxItem(spaceId, accountId),
            // By default condition check errors from `createItem()` call won't retry. Make
            // sure we handle race conditions by retrying on condition check error.
            {isConditionCheckErrorRetriable: true},
        );

        return (await getEvent(context)).item;
    });
}
