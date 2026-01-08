import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getInitialInboxItem} from "~/server/notifications/data/internal/get_initial_inbox_item.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";

/**
 * Get the session account's inbox in the provided space.
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
): Promise<DynamoGeneralRealtimeItem<InboxModel>> {
    const accountId = context.actor.getAccountId();

    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots don't have an inbox.
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    return context.dynamo.retryTransaction(async context => {
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
