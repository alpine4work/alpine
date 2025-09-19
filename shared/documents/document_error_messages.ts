import {AccessLevel} from "~/shared/access/access_policy.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";

export const documentPermissionDeniedErrorDisplayMessageByExpectedAccessLevel: Record<
    AccessLevel,
    ErrorDisplayMessage
> = {
    View: errorDisplayMessage`You aren’t allowed to access this document. Ask someone with access to share it with you.`,
    Comment: errorDisplayMessage`You aren’t allowed to see comments on this document. Ask someone who can share the document to give you comment access.`,
    Edit: errorDisplayMessage`You aren’t allowed to edit this document. Ask someone who can share the document to give you edit access.`,
    Manage: errorDisplayMessage`You aren’t allowed to share this document. Ask someone who can share the document to give you share access.`,
};

// If the client detects this specific error message it will revert any
// confirmed but not persisted steps and try backfilling again.
export const documentBackfillFutureVersionErrorMessage =
    "Tried to backfill a future document version";

export function createDocumentNotFoundError(documentId?: string) {
    return new NotFoundError("Document not found", {
        aggregateDedupeKey: documentId,
        displayMessage: errorDisplayMessage`This document doesn’t exist. Try searching “my documents” to see documents you’ve created.`,
    });
}

export function createDocumentCommentThreadNotFoundError(
    documentId: DocumentId,
    commentThreadId: DocumentCommentThreadId,
) {
    return new NotFoundError("Document comment thread not found", {
        aggregateDedupeKey: `${documentId}-${commentThreadId}`,
        displayMessage: errorDisplayMessage`This comment thread doesn’t exist. Try searching “my documents” to see documents you’ve created.`,
    });
}

export function createDocumentCommentNotFoundError(
    documentId: DocumentId,
    commentThreadId: DocumentCommentThreadId,
    commentIndex: number,
) {
    return new NotFoundError("Document comment not found", {
        aggregateDedupeKey: `${documentId}-${commentThreadId}-${commentIndex}`,
        displayMessage: errorDisplayMessage`This comment doesn’t exist. Try searching “my document comments” to see your recent document comments.`,
    });
}
