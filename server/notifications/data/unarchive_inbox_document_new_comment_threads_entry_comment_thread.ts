import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {
    InboxDocumentCommentThreadEntryItemKey,
    InboxTable,
} from "~/server/notifications/data/internal/inbox_table.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";

/**
 * Unarchives an individual comment thread in a new comment threads inbox entry.
 */
export async function unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(
    context: ServerSessionActionContext,
    {
        spaceId,
        documentId,
        bucketGeneration,
        commentThreadId,
    }: {
        spaceId: SpaceId;
        documentId: DocumentId;
        bucketGeneration: number;
        commentThreadId: DocumentCommentThreadId;
    },
): Promise<void> {
    await updateInboxEntry(
        context,
        context.actor.getAccountId(),
        {
            partitionType: "Inbox",
            sortRangeType: "DocumentNewCommentThreadsEntry",
            spaceId,
            accountId: context.actor.getAccountId(),
            documentId,
            bucketGeneration,
        },
        async (item, {addAdditionalTransactionEntry}) => {
            // Noop so we're idempotent in case the item was deleted.
            if (!item) return "Noop";

            const commentThread = item.commentThreads.get(commentThreadId);

            if (!commentThread) {
                throw new FailedPreconditionError(
                    "Comment thread not found in new comment threads inbox entry",
                );
            }

            // The comment thread is already unarchived!
            if (!commentThread.isArchived) return "Noop";

            const commentThreads = new Map(item.commentThreads);
            commentThreads.set(commentThreadId, {...commentThread, isArchived: false});

            const documentCommentThreadEntryItemKey: InboxDocumentCommentThreadEntryItemKey = {
                partitionType: "Inbox",
                sortRangeType: "DocumentCommentThreadEntry",
                spaceId,
                accountId: context.actor.getAccountId(),
                documentId,
                commentThreadId,
            };

            const documentCommentThreadEntryItem =
                await InboxTable.getItemWithEventualThenStrongConsistency(
                    context,
                    documentCommentThreadEntryItemKey,
                );

            // Set `archiveNewCommentThreadsEntryAgain` to true so the next time we update the
            // `DocumentCommentThreadEntry` we'll also archive the comment thread in this
            // `DocumentNewCommentThreadsEntry` again. By default,
            // `updateInboxDocumentCommentThreadEntry()` only archives
            // `DocumentNewCommentThreadsEntry` when creating `DocumentCommentThreadEntry`.
            addAdditionalTransactionEntry(
                InboxTable.transactionDirectlyUpdateItem(
                    documentCommentThreadEntryItem.update({
                        archiveNewCommentThreadsEntryAgain: true,
                    }),
                ),
            );

            return {...item, commentThreads};
        },
    );
}
