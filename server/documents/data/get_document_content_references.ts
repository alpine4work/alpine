import {getContentReferences} from "~/server/content/get_content_references.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {
    authorizeDocumentAccess,
    batchGetDocumentCommentThreadsIfExists,
} from "~/server/documents/data/documents_table.js";
import {DocumentContentReferencedIds} from "~/shared/documents/document_content_referenced_ids.js";
import {DocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

export async function getDocumentContentReferences(
    context: ServerActionContext,
    documentId: DocumentId,
    referencedIds: DocumentContentReferencedIds,
): Promise<DocumentContentReferences> {
    const {spaceId} = await authorizeDocumentAccess(context, documentId);

    const [references, commentThreads] = await runAllPromises([
        getContentReferences(context, spaceId, referencedIds),
        referencedIds.commentThreadIds.size > 0
            ? batchGetDocumentCommentThreadsIfExists(context, {
                  documentId,
                  commentThreadIds: referencedIds.commentThreadIds,
              })
            : [],
    ]);

    const commentThreadById = new Map(
        mapIterable(filterIterable(commentThreads, isNonNullable), commentThread => [
            commentThread.id,
            {
                commentCount: commentThread.commentCount,
                commentAuthors: commentThread.commentAuthors,
            },
        ]),
    );

    return {
        ...references,
        commentThreadById,
    };
}
