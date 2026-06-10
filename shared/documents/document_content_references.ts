import {
    ContentReferences,
    ContentReferencesSchema,
    emptyContentReferences,
    isEmptyContentReferences,
    mergeContentReferences,
} from "~/shared/content/content_references.js";
import {
    DocumentContentSchema,
    DocumentWithOptionalTitleContentSchema,
} from "~/shared/documents/document_content_schema.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {DocumentCommentThreadId, SiteId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export type DocumentCommentThreadReference = SchemaType<
    typeof DocumentCommentThreadReferenceSchema
>;

export const DocumentCommentThreadReferenceSchema = Schema.object({
    commentCount: Schema.integer,
    commentAuthors: Schema.array(AccountModel.schema),
});

export type DocumentContentReferences = SchemaType<typeof DocumentContentReferencesSchema>;

/**
 * Documents may have content which needs data beyond what the base content type
 * needs.
 */
export const DocumentContentReferencesSchema = ContentReferencesSchema.merge(
    Schema.object({
        /**
         * The comment threads in our document. Deleting the text associated with a
         * document comment does not delete the underlying thread but the thread will no
         * longer be a part of this map.
         */
        commentThreadById: Schema.map(
            Schema.id<DocumentCommentThreadId>(),
            DocumentCommentThreadReferenceSchema,
        ),

        /**
         * Sites referenced by this document's access policy. When a document has a Site
         * access policy, the site preview is stored here so the client can look it up
         * directly without needing to fetch it separately.
         *
         * We maintain a map so that the client always has access to the current site and
         * also any previous sites. For example, if a user changes the site access policy,
         * we need to be able to access the previous access policy until the change is
         * persisted to the server.
         */
        siteById: Schema.map(Schema.id<SiteId>(), SitePreviewModel.schema),
    }),
);

export const emptyDocumentContentReferences: DocumentContentReferences = {
    ...emptyContentReferences,
    commentThreadById: emptyMap,
    siteById: emptyMap,
};

export function isEmptyDocumentContentReferences(references: DocumentContentReferences): boolean {
    // If you add more data to `DocumentContentReferences` in the future, you'll need
    // to come back and update this function.
    assertEqualTypes<
        Exclude<keyof DocumentContentReferences, keyof ContentReferences>,
        "commentThreadById" | "siteById"
    >();

    return (
        isEmptyContentReferences(references) &&
        references.commentThreadById.size === 0 &&
        references.siteById.size === 0
    );
}

export function mergeDocumentContentReferences(
    references1: DocumentContentReferences,
    references2: DocumentContentReferences,
): DocumentContentReferences {
    // Optimization: Don't create a new references object for every step we receive
    // from the server with empty references.
    if (isEmptyDocumentContentReferences(references1)) return references2;
    if (isEmptyDocumentContentReferences(references2)) return references1;

    const referencesBase = mergeContentReferences(references1, references2);

    const commentThreadById = new Map<
        DocumentCommentThreadId,
        {
            commentCount: number;
            commentAuthors: ReadonlyArray<AccountModel>;
        }
    >();

    // Merge comment threads together by taking the one with the higher comment count.
    // Comments may never be deleted so the comment thread with more comments is
    // guaranteed to be newer.
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

    // Merge sites by ID, taking the one with the higher version for each site.
    const siteById = new Map<SiteId, SitePreviewModel>();
    for (const [siteId, site] of concatIterables(references1.siteById, references2.siteById)) {
        const existingSite = siteById.get(siteId);
        if (existingSite) {
            siteById.set(siteId, existingSite.merge(site));
        } else {
            siteById.set(siteId, site);
        }
    }

    return {
        ...referencesBase,
        commentThreadById,
        siteById,
    };
}

export type DocumentContentWithReferences = SchemaType<typeof DocumentContentWithReferencesSchema>;

export const DocumentContentWithReferencesSchema = Schema.object({
    doc: DocumentContentSchema,
    references: DocumentContentReferencesSchema,
});

export type DocumentWithOptionalTitleContentWithReferences = SchemaType<
    typeof DocumentWithOptionalTitleContentWithReferencesSchema
>;

export const DocumentWithOptionalTitleContentWithReferencesSchema = Schema.object({
    doc: DocumentWithOptionalTitleContentSchema,
    references: DocumentContentReferencesSchema,
});
