import {ContentReferencedIdsSchema} from "~/shared/content/content_referenced_ids.js";
import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {DocumentContentReferencedIdsSchema} from "~/shared/documents/document_content_referenced_ids.js";
import {DocumentContentReferencesSchema} from "~/shared/documents/document_content_references.js";
import {DocumentContentStepSchema} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
    DocumentPreviewModel,
} from "~/shared/documents/document_model.js";
import {
    AccountId,
    ContentEditorClientId,
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {MessageChangeSchema} from "~/shared/messaging/message_change_schema.js";
import {MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

export const authorizeDocumentAccess = defineRpc({
    name: "authorizeDocumentAccess",
    input: {
        documentId: Schema.id<DocumentId>(),
    },
    output: {},
});

export const createDocument = defineRpc({
    name: "createDocument",
    input: {
        spaceId: Schema.id<SpaceId>(),
        documentId: Schema.id<DocumentId>().optional(),
    },
    output: {
        documentId: Schema.id<DocumentId>(),
        createdTime: Schema.date,
    },
});

export const getDocument = defineRpc({
    name: "getDocument",
    input: {
        documentId: Schema.id<DocumentId>(),
    },
    output: {
        document: DocumentModel.schema(),
    },
});

export const getDocumentPreviewIfExists = defineRpc({
    name: "getDocumentPreviewIfExists",
    input: {
        documentId: Schema.id<DocumentId>(),
    },
    output: {
        documentPreview: DocumentPreviewModel.schema().nullable(),
    },
});

export const getDocumentContentSteps = defineRpc({
    name: "getDocumentContentSteps",
    input: {
        documentId: Schema.id<DocumentId>(),
        startVersion: Schema.integer,
        endVersion: Schema.integer,
    },
    output: {
        steps: Schema.array(
            Schema.object({
                step: DocumentContentStepSchema,
                invertedStep: DocumentContentStepSchema,
                clientId: Schema.id<ContentEditorClientId>(),
            }),
        ),
    },
});

export const updateDocumentContent = defineRpc({
    name: "updateDocumentContent",
    input: {
        documentId: Schema.id<DocumentId>(),
        version: Schema.integer,
        steps: Schema.array(DocumentContentStepSchema),
        clientId: Schema.id<ContentEditorClientId>(),
        createCommentThreads: Schema.array(
            Schema.object({
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                initialCommentContent: MessageContentSchema,
                createdTime: Schema.date.optional(),
            }),
        ),
        resolveCommentThreadIds: Schema.array(Schema.id<DocumentCommentThreadId>()).optional(),
        unresolveCommentThreadIds: Schema.array(Schema.id<DocumentCommentThreadId>()).optional(),
    },
    output: {
        conflictingSteps: Schema.array(
            Schema.object({
                step: DocumentContentStepSchema,
                clientId: Schema.id<ContentEditorClientId>(),
            }),
        ),
        updatedCommentThreads: Schema.array(DocumentCommentThreadModel.schema()),
    },
});

export const getDocumentContentReferences = defineRpc({
    name: "getDocumentContentReferences",
    input: {
        documentId: Schema.id<DocumentId>(),
        referencedIds: DocumentContentReferencedIdsSchema,
    },
    output: {
        references: DocumentContentReferencesSchema,
    },
});

export const getDocumentCommentThreadAndInitialCommentsIfExists = defineRpc({
    name: "getDocumentCommentThreadAndInitialCommentsIfExists",
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        limit: Schema.integer,
    },
    output: {
        commentThread: DocumentCommentThreadModel.schema().nullable(),
        initialComments: Schema.array(DocumentCommentModel.schema()),
        initialOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
    },
});

export const getDocumentCommentsFromStart = defineRpc({
    name: "getDocumentCommentsFromStart",
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        limit: Schema.integer,
        afterCommentIndex: Schema.integer.nullable(),
        beforeCommentIndex: Schema.integer.nullable(),
    },
    output: {
        commentCount: Schema.integer,
        comments: Schema.array(DocumentCommentModel.schema()),
        otherReferencedComments: Schema.array(DocumentCommentModel.schema()),
        lastCommentChangeTime: Schema.date.nullable(),
    },
});

export const getDocumentCommentsFromEnd = defineRpc({
    name: "getDocumentCommentsFromEnd",
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        limit: Schema.integer,
        afterCommentIndex: Schema.integer.nullable(),
        beforeCommentIndex: Schema.integer.nullable(),
    },
    output: {
        commentCount: Schema.integer,
        comments: Schema.array(DocumentCommentModel.schema()),
        otherReferencedComments: Schema.array(DocumentCommentModel.schema()),
        lastCommentChangeTime: Schema.date.nullable(),
    },
});

export const createDocumentComment = defineRpc({
    name: "createDocumentComment",
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        parentCommentIndex: Schema.integer.nullable(),
        content: MessageContentSchema,
    },
    output: {
        comment: DocumentCommentModel.schema(),
    },
});

export const updateDocumentCommentContent = defineRpc({
    name: "updateDocumentCommentContent",
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        commentIndex: Schema.integer,
        content: MessageContentSchema,
    },
    output: {
        contentUpdatedTime: Schema.date,
        contentReferences: ContentReferencesSchema,
    },
});

export const deleteDocumentComment = defineRpc({
    name: "deleteDocumentComment",
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        commentIndex: Schema.integer,
    },
    output: {
        deletedTime: Schema.date,
    },
});

export const backfillDocumentComments = defineRpc({
    name: "backfillDocumentComments",
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        clientCommentCount: Schema.integer,
        clientLastCommentChangeTime: Schema.date.nullable(),
        newCommentLimit: Schema.integer,
    },
    output: {
        commentThread: DocumentCommentThreadModel.schema(),
        commentCount: Schema.integer,
        lastCommentChangeTime: Schema.date.nullable(),
        newComments: Schema.array(DocumentCommentModel.schema()),
        newOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
        commentChangesResult: Schema.union({
            Available: Schema.object({
                type: Schema.value("Available"),
                changes: Schema.array(MessageChangeSchema),
            }),
            Unavailable: Schema.object({
                type: Schema.value("Unavailable"),
            }),
        }),
    },
});

/**
 * Load the references needed to return a `DocumentCommentModel` for an
 * optimistic document comment thread.
 *
 * Doesn't actually do anything related to a document at the moment. Could be
 * in a generic `messaging_rpc_definitions.ts` file.
 */
export const getOptimisticDocumentCommentReferences = defineRpc({
    name: "getOptimisticDocumentCommentReferences",
    input: {
        spaceId: Schema.id<SpaceId>(),
        authorId: Schema.id<AccountId>(),
        contentReferencedIds: ContentReferencedIdsSchema,
    },
    output: {
        author: AccountModel.schema,
        contentReferences: ContentReferencesSchema,
    },
});

export const getResolvedDocumentCommentThreadRanges = defineRpc({
    name: "getResolvedDocumentCommentThreadRanges",
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
    },
    output: {
        version: Schema.integer,
        ranges: Schema.array(
            Schema.object({
                from: Schema.integer,
                to: Schema.integer,
            }),
        ),
    },
});
