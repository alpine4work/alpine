import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getInboxEntriesForAccount} from "~/server/notifications/data/get_inbox_entries_for_account.js";
import {InboxEntriesIndex} from "~/server/notifications/data/internal/inbox_table.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {RynamoBackfillResult, RynamoIndexQueryResult} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {InboxEntryStatus} from "~/shared/notifications/inbox_entry_status.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

/**
 * Get the entries for the current session account's inbox. Enforces that the actor
 * is a session actor and not a bot, as bots don't have an inbox.
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
        filter: InboxEntryStatus;
        limit: number;
        afterCursor: DynamoIndexCursor | null;
    },
): Promise<RynamoIndexQueryResult<InboxEntryModel>> {
    const sessionContext = context.actor.authorizeSession();
    const accountId = sessionContext.actor.getAccountId();

    // Bot session actors don't have an inbox.
    await authorizeNotBotSpaceAccount(sessionContext, spaceId, accountId);

    return await getInboxEntriesForAccount(sessionContext, {
        spaceId,
        accountId,
        filter,
        limit,
        afterCursor,
    });
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
): Promise<RynamoBackfillResult<InboxEntryModel>> {
    const accountId = context.actor.getAccountId();

    await runAllPromises([
        authorizeSpaceAccess(context, spaceId),

        // Bots don't have an inbox.
        authorizeNotBotSpaceAccount(context, spaceId, accountId),
    ]);

    return await InboxEntriesIndex.backfillRealtimeQuery(context, {
        partitionKey: {spaceId, accountId},
        checkpoint,
    });
}
