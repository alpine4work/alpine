import {AccountModel} from "~/shared/accounts/account_model.js";
import {
    ContentReferences,
    ContentReferencesSchema,
    emptyContentReferences,
    isEmptyContentReferences,
} from "~/shared/content/content_references.js";
import {
    DocumentContentSchema,
    UncheckedDocumentContentSchema,
} from "~/shared/documents/document_content_schema.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export type DocumentCommentThreadReference = SchemaType<
    typeof DocumentCommentThreadReferenceSchema
>;

export const DocumentCommentThreadReferenceSchema = Schema.object({
    commentCount: Schema.integer,
    commentAuthors: Schema.array(AccountModel.schema),
});

export type DocumentContentReferences = SchemaType<typeof DocumentContentReferencesSchema>;

/**
 * Documents may have content which needs data beyond what the base content
 * type needs.
 */
export const DocumentContentReferencesSchema = ContentReferencesSchema.merge(
    Schema.object({
        /**
         * The comment threads in our document. Deleting the text associated with a
         * document comment does not delete the underlying thread but the thread will
         * no longer be a part of this map.
         */
        commentThreadById: Schema.map(
            Schema.id<DocumentCommentThreadId>(),
            DocumentCommentThreadReferenceSchema,
        ),
    }),
);

export const emptyDocumentContentReferences: DocumentContentReferences = {
    ...emptyContentReferences,
    commentThreadById: new Map(),
};

export function isEmptyDocumentContentReferences(references: DocumentContentReferences): boolean {
    // If you add more data to `DocumentContentReferences` in the future, you'll
    // need to come back and update this function.
    assertEqualTypes<
        Exclude<keyof DocumentContentReferences, keyof ContentReferences>,
        "commentThreadById"
    >();

    return isEmptyContentReferences(references) && references.commentThreadById.size === 0;
}

export function mergeDocumentContentReferences(
    references1: DocumentContentReferences,
    references2: DocumentContentReferences,
): DocumentContentReferences {
    // Optimization: Don't create a new references object for every step we receive
    // from the server with empty references.
    if (isEmptyDocumentContentReferences(references1)) return references2;
    if (isEmptyDocumentContentReferences(references2)) return references1;

    const commentThreadById = new Map<
        DocumentCommentThreadId,
        {
            commentCount: number;
            commentAuthors: ReadonlyArray<AccountModel>;
        }
    >();

    // Merge comment threads together by taking the one with the higher comment
    // count. Comments may never be deleted so the comment thread with more
    // comments is guaranteed to be newer.
    for (const [commentThreadId, commentThread] of concatIterables(
        references1.commentThreadById,
        references2.commentThreadById,
    )) {
        const existingCommentThread = commentThreadById.get(commentThreadId);
        if (
            !existingCommentThread ||
            existingCommentThread.commentCount < commentThread.commentCount
        ) {
            commentThreadById.set(commentThreadId, commentThread);
        }
    }

    return {
        accountById: new Map(concatIterables(references1.accountById, references2.accountById)),
        commentThreadById,
    };
}

export type DocumentContentWithReferences = SchemaType<typeof DocumentContentWithReferencesSchema>;

export const DocumentContentWithReferencesSchema = Schema.object({
    doc: DocumentContentSchema,
    references: DocumentContentReferencesSchema,
});

export type UncheckedDocumentContentWithReferences = SchemaType<
    typeof UncheckedDocumentContentWithReferencesSchema
>;

export const UncheckedDocumentContentWithReferencesSchema = Schema.object({
    doc: UncheckedDocumentContentSchema,
    references: DocumentContentReferencesSchema,
});
