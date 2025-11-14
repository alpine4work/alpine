import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getInboxEntryItemKey} from "~/server/notifications/data/internal/get_inbox_entry_item_key.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {NotFoundError} from "~/shared/error/error.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxEntryKey} from "~/shared/notifications/inbox_model.js";

/**
 * Unarchives an inbox entry. Moves the entry out of an account's archive and
 * into their primary inbox. Puts the unarchived entry at the top of the
 * primary inbox so the user can easily find it.
 */
export async function unarchiveInboxEntry(
    context: ServerSessionActionContext,
    {spaceId, key}: {spaceId: SpaceId; key: InboxEntryKey},
): Promise<void> {
    await updateInboxEntry(
        context,
        context.actor.getAccountId(),
        getInboxEntryItemKey({
            spaceId,
            accountId: context.actor.getAccountId(),
            key,
        }),
        item => {
            if (!item) throw new NotFoundError("Inbox entry not found");

            item = {
                ...item,
                isArchived: false,
                loudNotificationCount: 0,
            };

            // When unarchiving a channel posts entry, all `PostId`s in the entry are now
            // considered unarchived.
            if (item.sortRangeType === "ChannelPostsEntry") {
                item = {
                    ...item,
                    archivedPostIds: emptySet,
                };
            }

            // When unarchiving a comment threads entry, all `DocumentCommentThreadId`s in
            // the entry are now considered unarchived.
            if (item.sortRangeType === "DocumentNewCommentThreadsEntry") {
                item = {
                    ...item,
                    archivedCommentThreadIds: emptySet,
                };
            }

            return item;
        },
    );
}
