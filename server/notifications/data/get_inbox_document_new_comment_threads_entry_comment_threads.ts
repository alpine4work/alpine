import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getDocumentAndCommentThreadsWithInitialComments} from "~/server/documents/data/documents_actions.js";
import {
    InboxDocumentNewCommentThreadsEntryItemKey,
    InboxTable,
} from "~/server/notifications/data/internal/inbox_table.js";
import {observeInboxItem} from "~/server/notifications/data/internal/observe_inbox_item.js";
import {authorizeNotBotSpaceAccount} from "~/server/spaces/authorize_not_bot_space_account.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/documents/document_model.js";
import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {InboxDocumentNewCommentThreadsEntryModel} from "~/shared/notifications/inbox_model.js";

/**
 * Get all the comment threads in the inbox entry and some initial comments for
 * those threads up to the provided comment limit. After you call this function,
 * you're guaranteed that the list of comment threads in the entry will not change
 * anymore. This means you don't need to subscribe to realtime updates of the
 * document comment thread list for the entry. You still need to subscribe to
 * realtime updates for new comments within threads.
 *
 * This has a side effect of observing the inbox if the inbox has not been observed
 * since the entry was created. By observing the inbox we freeze the underlying
 * document comment threads entry so it will accumulate no new threads.
 */
export async function getInboxDocumentNewCommentThreadsEntryCommentThreads(
    context: ServerSessionActionContext,
    {
        spaceId,
        documentId,
        bucketGeneration,
        commentLimit,
        commentThreadCountAgainstLimit,
    }: {
        spaceId: SpaceId;
        documentId: DocumentId;
        bucketGeneration: number;
        commentLimit: number;
        commentThreadCountAgainstLimit: number;
    },
): Promise<{
    inboxEntry: RynamoItem<InboxDocumentNewCommentThreadsEntryModel>;
    document: DocumentModel;
    commentThreads: ReadonlyArray<DocumentCommentThreadModel>;
    initialCommentsByCommentThreadId: Map<
        DocumentCommentThreadId,
        {
            comments: Array<DocumentCommentModel>;
            otherReferencedComments: Array<DocumentCommentModel>;
        }
    >;
}> {
    const inboxEntryPromise = (async () => {
        const accountId = context.actor.getAccountId();

        await runAllPromises([
            authorizeSpaceAccess(context, spaceId),

            // Bots don't have an inbox.
            authorizeNotBotSpaceAccount(context, spaceId, accountId),
        ]);

        // If an inbox entry exists then the inbox attributes item should also exist.
        const inboxItem = await InboxTable.getItem(
            context,
            {
                partitionType: "Account",
                sortRangeType: "InboxAttributes",
                spaceId,
                accountId,
            },
            {
                // Use a strong read consistency to make sure we get the up-to-date generation.
                consistency: "Strong",
            },
        );

        // If the bucket generation is equal to the current inbox generation then we want
        // to increment the inbox's generation. This means new comment threads will create
        // a new entry with a new bucket generation.
        if (bucketGeneration === inboxItem.generation) {
            await InboxTable.updateItem(
                context,
                {
                    partitionType: "Account",
                    sortRangeType: "InboxAttributes",
                    spaceId,
                    accountId,
                },
                item => {
                    // If the generation was updated concurrently, we don't need to update it again.
                    if (item.generation !== bucketGeneration) return item;

                    return observeInboxItem(item);
                },
                {initialItem: inboxItem},
            );
        }

        const inboxEntryItemKey: InboxDocumentNewCommentThreadsEntryItemKey = {
            partitionType: "Inbox",
            sortRangeType: "DocumentNewCommentThreadsEntry",
            spaceId,
            accountId,
            documentId,
            bucketGeneration,
        };

        const inboxEntry = await InboxTable.getRealtimeItemIfExists(context, inboxEntryItemKey, {
            // Use a strong read consistency when reading the entry since we don't want to miss
            // any comment threads.
            //
            // At this point the comment threads entry is frozen. So we don't subscribe to
            // realtime changes for `commentThreadIds`.
            consistency: "Strong",
        });

        // It's possible you open a channel posts inbox entry that has been deleted since
        // all of its posts have been archived (maybe the user bookmarked the inbox entry's
        // URL?). In this case, we want to show a display message to the user telling them
        // this is the case.
        if (!inboxEntry) {
            const deletedInboxEntry = await InboxTable.getDeletedItemIfExists(
                context,
                inboxEntryItemKey,
                {consistency: "Strong"},
            );

            throw new NotFoundError("Document new comment threads entry not found", {
                displayMessage: deletedInboxEntry
                    ? errorDisplayMessage`All comment threads in this notification have been marked as done.`
                    : errorDisplayMessage`This notification doesn\u2019t exist.`,
            });
        }

        return inboxEntry;
    })();

    const [inboxEntry, {document, commentThreads, initialCommentsByCommentThreadId}] =
        await runAllPromises([
            inboxEntryPromise,
            getDocumentAndCommentThreadsWithInitialComments(context, {
                documentId,
                commentThreadIds: inboxEntryPromise.then(
                    inboxEntry => inboxEntry.model.commentThreadIds,
                ),
                commentLimit,
                commentThreadCountAgainstLimit,
            }),
        ]);

    return {
        inboxEntry,
        document,
        commentThreads,
        initialCommentsByCommentThreadId,
    };
}
