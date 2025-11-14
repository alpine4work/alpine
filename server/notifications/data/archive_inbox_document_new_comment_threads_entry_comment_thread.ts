import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {
    InboxDocumentCommentThreadEntryItemKey,
    InboxTable,
} from "~/server/notifications/data/internal/inbox_table.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Archive an individual comment thread in a new comment threads inbox entry.
 * If this is the last comment thread to be archived then we archive the entire
 * new comment threads entry.
 */
export async function archiveInboxDocumentNewCommentThreadsEntryCommentThread(
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
        async (item, {isInitialAttempt, updateOtherInboxEntry}) => {
            // Noop so we're idempotent in case the item was deleted.
            if (!item) return "Noop";

            const commentThread = item.commentThreads.get(commentThreadId);

            if (!commentThread) {
                throw new FailedPreconditionError(
                    "Comment thread not found in new comment threads inbox entry",
                );
            }

            // The comment thread is already archived!
            if (commentThread.isArchived) return "Noop";

            const commentThreads = new Map(item.commentThreads);
            commentThreads.set(commentThreadId, {...commentThread, isArchived: true});

            const documentCommentThreadEntryItemKey: InboxDocumentCommentThreadEntryItemKey = {
                partitionType: "Inbox",
                sortRangeType: "DocumentCommentThreadEntry",
                spaceId,
                accountId: context.actor.getAccountId(),
                documentId,
                commentThreadId,
            };

            // There's only a `DocumentCommentThreadEntry` for a comment thread in our
            // `DocumentNewCommentThreadsEntry` during race conditions. So for the initial
            // attempt of this function, don't load the document comment thread entry. If
            // this function retries, it may be because the `DocumentCommentThreadEntry`
            // already exists and we need to update it instead.
            const documentCommentThreadEntryItem = isInitialAttempt
                ? null
                : await InboxTable.getItemIfExists(context, documentCommentThreadEntryItemKey);

            // When we delete the `CommentThreadId` from `commentThreads`, we need to create
            // a `DocumentCommentThreadEntry` item if one doesn't already exist. So the
            // user can go to the "Old" section of their inbox and unarchive this comment
            // thread individually.
            if (!documentCommentThreadEntryItem) {
                updateOtherInboxEntry(
                    documentCommentThreadEntryItemKey,
                    documentCommentThreadEntryItem,
                    {
                        isArchived: [true, {alwaysCreate: true}],
                        loudNotificationCount: 0,
                        firstCommentAuthorId: commentThread.authorId,
                        latestComment: {
                            index: 0,
                            authorId: commentThread.authorId,
                            createdTime: commentThread.createdTime,
                            isStickyMention: false,
                        },
                        latestArchivingCommentIndex: null,
                        otherCommentAuthorId: null,
                        // Render this entry in the archive section of the inbox the same as a
                        // `DocumentNewCommentThreadsEntry` with one comment thread.
                        isFromNewCommentThread: true,
                    },
                );
            }

            // If all comment threads are now archived then delete the entire inbox entry!
            if (iterableEvery(commentThreads.values(), commentThread => commentThread.isArchived)) {
                return "Delete";
            }

            return {...item, commentThreads};
        },
    );
}
