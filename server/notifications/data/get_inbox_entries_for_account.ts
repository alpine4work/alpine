import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeInboxAccessForAccount} from "~/server/notifications/data/authorize_inbox_access_for_account.js";
import {InboxEntriesIndex} from "~/server/notifications/data/internal/inbox_table.js";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {RynamoIndexQueryResult} from "~/shared/dynamo/rynamo_types.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {InboxEntryStatus} from "~/shared/notifications/inbox_entry_status.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";

/**
 * Get the entries for `accountId`'s inbox in `spaceId`. Authorization is via
 * `authorizeInboxAccessForAccount()`, so this works for any actor type that has
 * access to read the inbox (session, impersonated, bot, or system).
 */
export async function getInboxEntriesForAccount(
    context: ServerActionContext,
    {
        spaceId,
        accountId,
        limit,
        afterCursor,
        filter,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        limit: number;
        afterCursor: DynamoIndexCursor | null;
        filter?: InboxEntryStatus;
    },
): Promise<RynamoIndexQueryResult<InboxEntryModel>> {
    await authorizeInboxAccessForAccount(context, {
        spaceId,
        accountId,
        expectedAccessLevel: "View",
    });

    return await InboxEntriesIndex.realtimeQuery(context, {
        partitionKey: {spaceId, accountId},
        startSortKey:
            filter === "Done"
                ? {
                      isArchived: true,
                      generation: InboxEntriesIndex.sortKeyAttributes.generation.minValue,
                      enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.minValue,
                  }
                : undefined,
        endSortKey:
            filter === "New"
                ? {
                      isArchived: false,
                      generation: InboxEntriesIndex.sortKeyAttributes.generation.maxValue,
                      enteredTime: InboxEntriesIndex.sortKeyAttributes.enteredTime.maxValue,
                  }
                : undefined,
        limit,
        paginate: {type: "FromStart", afterCursor},
    });
}
