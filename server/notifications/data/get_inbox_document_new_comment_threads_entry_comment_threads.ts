import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {getDocumentAndCommentThreadsWithInitialComments} from "~/server/documents/data/documents_actions.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {observeInboxItem} from "~/server/notifications/data/internal/observe_inbox_item.js";
import {authorizeNotBotSpaceAccount, authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
} from "~/shared/documents/document_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get all the comment threads in the inbox entry and some initial comments for
 * those threads up to the provided comment limit. After you call this
 * function, you're guaranteed that the list of comment threads in the entry
 * will not change anymore. This means you don't need to subscribe to realtime
 * updates of the document comment thread list for the entry. You still need to
 * subscribe to realtime updates for new comments within threads.
 *
 * This has a side effect of observing the inbox if the inbox has not been
 * observed since the entry was created. By observing the inbox we freeze the
 * underlying document comment threads entry so it will accumulate no
 * new threads.
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
    const commentThreadIdsPromise = (async () => {
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

        // If the bucket generation is equal to the current inbox generation then we
        // want to increment the inbox's generation. This means new comment threads will
        // create a new entry with a new bucket generation.
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
                    // If the generation was updated concurrently, we don't need to update
                    // it again.
                    if (item.generation !== bucketGeneration) return item;

                    return observeInboxItem(item);
                },
                {initialItem: inboxItem},
            );
        }

        const inboxEntryItem = await InboxTable.getItem(
            context,
            {
                partitionType: "Inbox",
                sortRangeType: "DocumentNewCommentThreadsEntry",
                spaceId,
                accountId,
                documentId,
                bucketGeneration,
            },
            {
                // Use a strong read consistency when reading the entry since we don't want to
                // miss any comment threads.
                //
                // At this point the comment threads entry is frozen. So we don't subscribe to
                // realtime changes for `commentThreadIds`.
                consistency: "Strong",
            },
        );

        return inboxEntryItem.commentThreadIds;
    })();

    const [, {document, commentThreads, initialCommentsByCommentThreadId}] = await runAllPromises([
        commentThreadIdsPromise,
        getDocumentAndCommentThreadsWithInitialComments(context, {
            documentId,
            commentThreadIds: commentThreadIdsPromise,
            commentLimit,
            commentThreadCountAgainstLimit,
        }),
    ]);

    return {
        document,
        commentThreads,
        initialCommentsByCommentThreadId,
    };
}
