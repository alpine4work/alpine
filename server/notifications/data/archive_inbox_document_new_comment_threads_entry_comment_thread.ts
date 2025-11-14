import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {updateInboxEntry} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {FailedPreconditionError, NotFoundError} from "~/shared/error/error.js";
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
        item => {
            if (!item) throw new NotFoundError("Inbox entry not found");

            if (!item.commentThreadIds.has(commentThreadId)) {
                throw new FailedPreconditionError(
                    "Comment thread not found in new comment threads inbox entry",
                );
            }

            const archivedCommentThreadIds = new Set(item.archivedCommentThreadIds);
            archivedCommentThreadIds.add(commentThreadId);

            return {
                ...item,
                isArchived: archivedCommentThreadIds.size === item.commentThreadIds.size,
                archivedCommentThreadIds,
            };
        },
    );
}
