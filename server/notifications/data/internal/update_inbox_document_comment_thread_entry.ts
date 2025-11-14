import {ServerActionContext} from "~/server/context/server_action_context.js";
import {
    InboxDocumentCommentThreadEntryItem,
    InboxDocumentCommentThreadEntryItemKey,
    InboxDocumentNewCommentThreadsEntryItemKey,
    InboxTable,
} from "~/server/notifications/data/internal/inbox_table.js";
import {
    InboxDocumentCommentThreadInNewCommentThreadsEntryItemKey,
    NotificationsTable,
} from "~/server/notifications/data/internal/notifications_table.js";
import {
    UpdateInboxEntryNewItem,
    updateInboxEntry,
} from "~/server/notifications/data/internal/update_inbox_entry.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {
    AccountId,
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.js";

export function updateInboxDocumentCommentThreadEntry(
    context: ServerActionContext,
    actorAccountId: AccountId,
    {
        spaceId,
        accountId,
        documentId,
        commentThreadId,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        documentId: DocumentId;
        commentThreadId: DocumentCommentThreadId;
    },
    update: (
        item: InboxDocumentCommentThreadEntryItem | null,
    ) => MaybePromise<
        | UpdateInboxEntryNewItem<
              InboxDocumentCommentThreadEntryItem,
              InboxDocumentCommentThreadEntryItemKey
          >
        | "Noop"
    >,
    {clientRequestToken}: {clientRequestToken?: string} = {},
) {
    return updateInboxEntry(
        context,
        actorAccountId,
        {
            partitionType: "Inbox",
            sortRangeType: "DocumentCommentThreadEntry",
            spaceId,
            accountId,
            documentId,
            commentThreadId,
        },
        async (oldItem, {addAdditionalTransactionEntry, updateOtherInboxEntry}) => {
            // If we're updating an existing `DocumentCommentThreadEntry` then don't bother
            // updating `DocumentNewCommentThreadsEntry`.
            if (oldItem) return update(oldItem);

            // If we're creating this `DocumentCommentThreadEntry` then at the same time if
            // the comment thread is present in `DocumentNewCommentThreadsEntry` then we
            // want to archive it in the `DocumentNewCommentThreadsEntry`. So the user
            // refers to `DocumentCommentThreadEntry` from now on for this comment thread.

            const commentThreadInNewCommentThreadsItemKey: InboxDocumentCommentThreadInNewCommentThreadsEntryItemKey =
                {
                    partitionType: "Inbox",
                    sortRangeType: "DocumentCommentThreadInNewCommentThreadsEntry",
                    spaceId,
                    accountId,
                    documentId,
                    commentThreadId,
                };

            const commentThreadInNewCommentThreadsItem = await NotificationsTable.getItemIfExists(
                context,
                commentThreadInNewCommentThreadsItemKey,
            );

            // The post isn't present in any `DocumentNewCommentThreadsEntry`.
            if (!commentThreadInNewCommentThreadsItem) {
                // Create the `DocumentCommentThreadInNewCommentThreadsEntry` item when we
                // commit this transaction. This item existing means if a
                // `CreateDocumentComment` event is processed later we'll automatically archive
                // the document comment thread in the new document comment threads entry.
                //
                // If the item already exists then we need to retry.
                addAdditionalTransactionEntry(
                    NotificationsTable.transactionCreateItem(
                        {...commentThreadInNewCommentThreadsItemKey, newCommentThreadsEntry: null},
                        {isConditionCheckErrorRetriable: true},
                    ),
                );

                return update(oldItem);
            }

            // If `newCommentThreadsEntry` is null that means the item was created by
            // `updateInboxDocumentCommentThreadEntry()`. Any `CreateDocumentComment`
            // events after `commentThreadInNewCommentThreadsItem` is created automatically
            // archive the new comment thread.
            if (commentThreadInNewCommentThreadsItem.newCommentThreadsEntry) {
                const newCommentThreadsItemKey: InboxDocumentNewCommentThreadsEntryItemKey = {
                    partitionType: "Inbox",
                    sortRangeType: "DocumentNewCommentThreadsEntry",
                    spaceId,
                    accountId,
                    documentId,
                    bucketGeneration:
                        commentThreadInNewCommentThreadsItem.newCommentThreadsEntry
                            .bucketGeneration,
                };

                // If we have a `DocumentCommentThreadInNewCommentThreadsEntry` item then
                // there's definitely a corresponding `DocumentNewCommentThreadsEntry` item.
                // First try loading the item with eventual consistency (cheap) and if that
                // doesn't work try strong consistency.
                const newCommentThreadsItem =
                    await InboxTable.getItemWithEventualThenStrongConsistency(
                        context,
                        newCommentThreadsItemKey,
                    );

                if (!newCommentThreadsItem.archivedCommentThreadIds.has(commentThreadId)) {
                    const archivedCommentThreadIds = new Set([
                        ...newCommentThreadsItem.archivedCommentThreadIds,
                        commentThreadId,
                    ]);

                    // Archive the `DocumentNewCommentThreadsEntry` if all posts within the
                    // `DocumentNewCommentThreadsEntry` have been archived.
                    const isArchived =
                        archivedCommentThreadIds.size ===
                        newCommentThreadsItem.commentThreadIds.size;

                    updateOtherInboxEntry(newCommentThreadsItemKey, newCommentThreadsItem, {
                        isArchived,
                        loudNotificationCount: !isArchived
                            ? newCommentThreadsItem.loudNotificationCount
                            : 0,
                        commentThreadIds: newCommentThreadsItem.commentThreadIds,
                        archivedCommentThreadIds,
                        commentThreadAuthorIds: newCommentThreadsItem.commentThreadAuthorIds,
                        firstCommentThread: newCommentThreadsItem.firstCommentThread,
                        latestCommentThreadCreatedTime:
                            newCommentThreadsItem.latestCommentThreadCreatedTime,
                    });
                }
            }

            return update(oldItem);
        },
        {clientRequestToken},
    );
}
