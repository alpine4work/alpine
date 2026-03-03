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
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
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
            if (oldItem && !oldItem.archiveNewCommentThreadsEntryAgain) return update(oldItem);

            let newItem = await update(oldItem);

            // Remove the `archiveNewCommentThreadsEntryAgain` flag now that we're archiving
            // `DocumentNewCommentThreadsEntry` again.
            if (newItem !== "Noop" && newItem.archiveNewCommentThreadsEntryAgain) {
                newItem = omitObject(newItem, ["archiveNewCommentThreadsEntryAgain"]);
            }

            // If we're creating this `DocumentCommentThreadEntry` then at the same time if the
            // comment thread is present in `DocumentNewCommentThreadsEntry` then we want to
            // archive it in the `DocumentNewCommentThreadsEntry`. So the user refers to
            // `DocumentCommentThreadEntry` from now on for this comment thread.

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
                // Create the `DocumentCommentThreadInNewCommentThreadsEntry` item when we commit
                // this transaction. This item existing means if a `CreateDocumentComment` event is
                // processed later we'll automatically archive the document comment thread in the
                // new document comment threads entry.
                //
                // If the item already exists then we need to retry.
                addAdditionalTransactionEntry(
                    NotificationsTable.transactionCreateItem(
                        {...commentThreadInNewCommentThreadsItemKey, newCommentThreadsEntry: null},
                        {isConditionCheckErrorRetriable: true},
                    ),
                );

                return newItem;
            }

            // If `newCommentThreadsEntry` is null that means the item was created by
            // `updateInboxDocumentCommentThreadEntry()`. Any `CreateDocumentComment` events
            // after `commentThreadInNewCommentThreadsItem` is created automatically archive
            // the new comment thread.
            if (!commentThreadInNewCommentThreadsItem.newCommentThreadsEntry) return newItem;

            const newCommentThreadsItemKey: InboxDocumentNewCommentThreadsEntryItemKey = {
                partitionType: "Inbox",
                sortRangeType: "DocumentNewCommentThreadsEntry",
                spaceId,
                accountId,
                documentId,
                bucketGeneration:
                    commentThreadInNewCommentThreadsItem.newCommentThreadsEntry.bucketGeneration,
            };

            // Item might not exist if we're running this job multiple times since the inbox
            // entry might have been deleted.
            const newCommentThreadsItem = await InboxTable.getItemIfExists(
                context,
                newCommentThreadsItemKey,
            );

            if (!newCommentThreadsItem) {
                addAdditionalTransactionEntry(
                    InboxTable.transactionDoesNotExistConditionCheck(newCommentThreadsItemKey),
                );
                return newItem;
            }

            const commentThread = newCommentThreadsItem.commentThreads.get(commentThreadId);

            // Comment thread is already archived in `DocumentNewCommentThreadsEntry`.
            if (!commentThread || commentThread.isArchived) {
                addAdditionalTransactionEntry(
                    InboxTable.transactionUpdateLockVersionConditionCheck(
                        newCommentThreadsItemKey,
                        newCommentThreadsItem.updateLockVersion,
                    ),
                );
                return newItem;
            }

            const commentThreads = new Map(newCommentThreadsItem.commentThreads);
            commentThreads.set(commentThreadId, {...commentThread, isArchived: true});

            if (iterableEvery(commentThreads.values(), commentThread => commentThread.isArchived)) {
                // If all comment threads are now archived then delete the entire inbox entry!
                updateOtherInboxEntry(newCommentThreadsItemKey, newCommentThreadsItem, "Delete");
            } else {
                updateOtherInboxEntry(newCommentThreadsItemKey, newCommentThreadsItem, {
                    ...newCommentThreadsItem,
                    commentThreads,
                });
            }

            if (newItem === "Noop") {
                newItem = oldItem ?? {
                    isArchived: true,
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
                };
            }

            // Make sure we always create an archived entry for the comment thread when we
            // archived the comment thread in its corresponding
            // `DocumentNewCommentThreadsEntry`. So the user can unarchive the comment thread
            // to put it back in their inbox.
            if (newItem.isArchived) {
                newItem = {
                    ...newItem,
                    isArchived: [true, {alwaysCreate: true}],
                };
            }

            return newItem;
        },
        {clientRequestToken},
    );
}
