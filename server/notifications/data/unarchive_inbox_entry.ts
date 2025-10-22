import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {getInboxEntryItemKey} from "~/server/notifications/data/internal/get_inbox_entry_item_key.js";
import {unarchivedInboxEntryGenerationIncrement} from "~/server/notifications/data/internal/inbox_generation_increments.js";
import {
    InboxAttributesItem,
    InboxEntryItemKey,
    InboxTable,
} from "~/server/notifications/data/internal/inbox_table.js";
import {authorizeNotBotSpaceAccount, authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxEntryKey} from "~/shared/notifications/inbox_model.js";

/**
 * Unarchives an inbox entry. Moves the entry out of an account's archive and
 * into their primary inbox. Puts the unarchived entry at the top of the
 * primary inbox so the user can easily find it.
 */
export function unarchiveInboxEntry(
    context: ServerSessionActionContext,
    {spaceId, key}: {spaceId: SpaceId; key: InboxEntryKey},
): Promise<void> {
    return unarchiveInboxEntryItemKey(
        context,
        getInboxEntryItemKey({
            spaceId,
            accountId: context.actor.getAccountId(),
            key,
        }),
    );
}

async function unarchiveInboxEntryItemKey(
    context: ServerSessionActionContext,
    itemKey: InboxEntryItemKey,
): Promise<void> {
    await runAllPromises([
        authorizeSpaceAccess(context, itemKey.spaceId),

        // Bots don't have an inbox.
        authorizeNotBotSpaceAccount(context, itemKey.spaceId, itemKey.accountId),
    ]);

    await context.dynamo.retryTransaction(async context => {
        const [inboxItem, inboxEntryItem] = await runAllPromises([
            InboxTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "InboxAttributes",
                spaceId: itemKey.spaceId,
                accountId: itemKey.accountId,
            }),
            InboxTable.getItemIfExists(context, itemKey),
        ]);

        if (!inboxEntryItem) throw new NotFoundError("Inbox entry not found");

        assert(
            inboxItem,
            "Can’t have inbox entry item without corresponding inbox attributes item",
        );

        // If the inbox entry item is already unarchived, do nothing.
        if (!inboxEntryItem.isArchived) return;

        const currentTime = new Date();

        const newInboxEntryItem = {
            ...inboxEntryItem,
            isArchived: false,
            // When unarchiving, move the unarchived entry to the top of the inbox so it's
            // easier to find. Unarchiving is a clear signal from the user that they care
            // about this entry.
            generation: inboxItem.generation + unarchivedInboxEntryGenerationIncrement,
            enteredTime: currentTime,
        };

        const newInboxItem: InboxAttributesItem = {
            ...inboxItem,
            entryCount: inboxItem.entryCount + 1,
            lastEntryUpdatedTime: currentTime,
        };

        await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
            InboxTable.transactionDirectlyUpdateItem(newInboxItem),
            InboxTable.transactionDirectlyUpdateItem(newInboxEntryItem),
        ]);
    });
}
