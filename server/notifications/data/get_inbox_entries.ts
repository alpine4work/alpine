import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {InboxEntriesIndex, InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {
    DynamoGeneralRealtimeBackfillResult,
    DynamoGeneralRealtimeIndexQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

/**
 * Get the entries for the current account's inbox.
 */
export async function getInboxEntries(
    context: ServerSessionActionContext,
    {
        spaceId,
        filter,
        limit,
        afterCursor,
    }: {
        spaceId: SpaceId;
        filter: "New" | "Archive";
        limit: number;
        afterCursor: DynamoIndexCursor | null;
    },
): Promise<DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>> {
    const accountId = context.actor.getAccountId();

    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots don't have an inbox.
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    const result = await InboxEntriesIndex.realtimeQuery(context, {
        partitionKey: {spaceId, accountId},
        startSortKey:
            filter === "Archive"
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

    // In test environments, if we've fetched all non-archived entries from the inbox
    // then test the inbox attributes item has the correct entry count.
    //
    // This works because we have a lot of Jest notification tests that load all
    // un-archived inbox entries.
    if (
        process.env.NODE_ENV === "test" &&
        filter === "New" &&
        afterCursor === null &&
        (result.pageInfo.type === "FromStart"
            ? !result.pageInfo.hasNextPage
            : !result.pageInfo.hasPreviousPage)
    ) {
        const inboxItem = await InboxTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId,
            accountId,
        });

        assert(
            (inboxItem?.entryCount ?? 0) === result.items.length,
            "Expected inbox item\u2019s `entryCount` to have the correct number of non-archived inbox entries",
        );

        assert(
            (inboxItem?.loudNotificationCount ?? 0) ===
                result.items.reduce(
                    (loudNotificationCount, item) =>
                        loudNotificationCount + item.model.loudNotificationCount,
                    0,
                ),
            "Expected inbox item\u2019s `loudNotificationCount` to be the sum of all non-archived inbox entry loud notification counts",
        );
    }

    return result;
}

/**
 * Backfill any inbox entry updates between now and `checkpoint`. Use when you
 * connect to realtime after reading data to make sure you haven't missed any
 * updates.
 *
 * This will backfill updates both for non-archived and archived entries.
 */
export async function backfillInboxEntries(
    context: ServerSessionActionContext,
    {spaceId, checkpoint}: {spaceId: SpaceId; checkpoint: ServerSynchronizationCheckpoint},
): Promise<DynamoGeneralRealtimeBackfillResult<InboxEntryModel>> {
    const accountId = context.actor.getAccountId();

    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots don't have an inbox.
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    return InboxEntriesIndex.backfillRealtimeQuery(context, {
        partitionKey: {spaceId, accountId},
        checkpoint,
    });
}
