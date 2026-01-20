import {AccessLevelSchema, AccessPolicySchema} from "~/shared/access/access_policy.js";
import {ShareNotificationSchema} from "~/shared/access/share_notification.js";
import {ContentReferencedIdsSchema} from "~/shared/content/content_referenced_ids.js";
import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {DocumentContentReferencedIdsSchema} from "~/shared/documents/document_content_referenced_ids.js";
import {DocumentContentReferencesSchema} from "~/shared/documents/document_content_references.js";
import {
    DocumentContentSchema,
    DocumentContentStepSchema,
} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
    DocumentPreviewModel,
} from "~/shared/documents/document_model.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {
    AccountId,
    ContentEditorClientId,
    DocumentCommentThreadId,
    DocumentId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {
    MessageContentSchema,
    MessageContentStepSchema,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayloadModelFileSchema} from "~/shared/messaging/message_model.js";
import {MessagePosOrFilesSchema} from "~/shared/messaging/message_pos_or_files_schema.js";
import {
    MessageReferencedIdsSchema,
    MessageReferencesSchema,
} from "~/shared/messaging/message_references.js";
import {MessageContentPayloadParentSchema} from "~/shared/messaging/message_schema.js";
import {createMessageUpdatesBackfillResultSchema} from "~/shared/messaging/messaging_realtime_protocol.js";
import {AddMarksAfterRemoveAllStepRangeSchema} from "~/shared/prosemirror/create_schema_for_prosemirror_schema.js";
import {ReactionOrGenericLikeSchema} from "~/shared/reactions/reaction_schema.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {ServerSynchronizationCheckpointSchema} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export const authorizeDocumentAccess = defineRpc({
    name: "authorizeDocumentAccess",
    isIdempotent: true,
    input: {
        documentId: Schema.id<DocumentId>(),
        expectedAccessLevel: AccessLevelSchema,
        // If true, also calls `authorizeSpaceAccess()`. If a document has a non-null
        // `accessPolicy.urlGrant` then space access isn't required. Setting this true
        // makes sure the actor has space access even if `accessPolicy.urlGrant` is
        // non-null.
        withSpaceAccess: Schema.boolean.optional(),
    },
    output: {},
});

export const createDocument = defineRpc({
    name: "createDocument",
    // Fails if the document already exists (when `documentId` is provided).
    // Generates a new `documentId` otherwise.
    isIdempotent: false,
    input: {
        spaceId: Schema.id<SpaceId>(),
        documentId: Schema.id<DocumentId>().optional(),
        content: DocumentContentSchema.optional(),
    },
    output: {
        documentId: Schema.id<DocumentId>(),
        createdTime: Schema.date,
    },
});

export const getDocument = defineRpc({
    name: "getDocument",
    isIdempotent: true,
    input: {
        documentId: Schema.id<DocumentId>(),
    },
    output: {
        document: DocumentModel.schema(),
    },
});

// This RPC returns document content with comment marks even if the actor is a
// viewer! It's a privilege escalation that's only allowed if the collaboration
// service is calling this RPC. The collaboration service durable object needs
// the full document content to function. If a viewer initializes the durable
// object and an editor connects later, the editor still needs to see the
// document with comment marks.
//
// The collaboration service needs to implement additional authorization checks
// to make sure it doesn't return document content with comment marks to users
// who only have view access.
export const getDocumentContentForCollaborationServiceInitialization = defineRpc({
    name: "getDocumentContentForCollaborationServiceInitialization",
    isIdempotent: true,
    input: {
        documentId: Schema.id<DocumentId>(),
    },
    output: {
        spaceId: Schema.id<SpaceId>(),
        version: Schema.integer,
        content: DocumentContentSchema,
    },
});

export const getDocumentPreviewIfExists = defineRpc({
    name: "getDocumentPreviewIfExists",
    isIdempotent: true,
    input: {
        documentId: Schema.id<DocumentId>(),
    },
    output: {
        documentPreview: DocumentPreviewModel.schema().nullable(),
    },
});

export const getDocumentContentSteps = defineRpc({
    name: "getDocumentContentSteps",
    isIdempotent: true,
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
    isIdempotent: true,
    input: {
        documentId: Schema.id<DocumentId>(),
        version: Schema.integer,
        steps: Schema.array(DocumentContentStepSchema),
        clientId: Schema.id<ContentEditorClientId>(),
        createCommentThreads: Schema.array(
            Schema.object({
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                initialCommentContent: MessageContentSchema,
                initialCommentFileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),
                createdTimeZone: TimeZoneSchema,
                createdTime: Schema.date.optional(),
            }),
        ),
        intentionallyUpdateAccessPolicy: Schema.object({
            accessPolicy: AccessPolicySchema,
            notification: ShareNotificationSchema.nullable(),
        }).optional(),
        resolveCommentThreadIds: Schema.array(Schema.id<DocumentCommentThreadId>()).optional(),
        unresolveCommentThreadIds: Schema.array(Schema.id<DocumentCommentThreadId>()).optional(),
    },
    output: {
        newVersion: Schema.integer,
        updatedCommentThreads: Schema.array(DocumentCommentThreadModel.schema()),
    },
});

export const getDocumentContentReferences = defineRpc({
    name: "getDocumentContentReferences",
    isIdempotent: true,
    input: {
        documentId: Schema.id<DocumentId>(),
        referencedIds: DocumentContentReferencedIdsSchema,
    },
    output: {
        references: DocumentContentReferencesSchema,
        resolvedCommentThreadIds: Schema.set(Schema.id<DocumentCommentThreadId>()),
    },
});

export const confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency = defineRpc({
    name: "confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency",
    isIdempotent: true,
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadIds: Schema.array(Schema.id<DocumentCommentThreadId>()),
    },
    output: {
        confirmedCommentThreadIds: Schema.array(Schema.id<DocumentCommentThreadId>()),
    },
});

export const getDocumentCommentThreadAndInitialCommentsIfExists = defineRpc({
    name: "getDocumentCommentThreadAndInitialCommentsIfExists",
    isIdempotent: true,
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
    isIdempotent: true,
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
    },
});

export const getDocumentCommentsFromEnd = defineRpc({
    name: "getDocumentCommentsFromEnd",
    isIdempotent: true,
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
    },
});

export const createDocumentComment = defineRpc({
    name: "createDocumentComment",
    // Creates two comments if called twice.
    isIdempotent: false,
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        createdTimeZone: TimeZoneSchema,
        parent: MessageContentPayloadParentSchema.nullable(),
        content: MessageContentSchema,
        fileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),
    },
    output: {
        index: Schema.integer,
        createdTime: Schema.date,
    },
});

export const updateDocumentCommentContent = defineRpc({
    name: "updateDocumentCommentContent",
    // Fails if `contentVersion` isn't the current version.
    isIdempotent: false,
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        commentIndex: Schema.integer,
        contentVersion: Schema.integer,
        steps: Schema.array(MessageContentStepSchema),
    },
    output: {
        version: Schema.integer,
    },
});

export const deleteDocumentComment = defineRpc({
    name: "deleteDocumentComment",
    // Fails if the comment is already deleted.
    isIdempotent: false,
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        commentIndex: Schema.integer,
    },
    output: {
        version: Schema.integer,
    },
});

export const setDocumentCommentReaction = defineRpc({
    name: "setDocumentCommentReaction",
    isIdempotent: true,
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        commentIndex: Schema.integer,
        contentVersion: Schema.integer,
        pos: MessagePosOrFilesSchema,
        reaction: ReactionOrGenericLikeSchema,
    },
    output: {
        version: Schema.integer,
    },
});

export const deleteDocumentCommentReaction = defineRpc({
    name: "deleteDocumentCommentReaction",
    isIdempotent: true,
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        commentIndex: Schema.integer,
        contentVersion: Schema.integer,
        pos: MessagePosOrFilesSchema,
    },
    output: {
        version: Schema.integer,
    },
});

export const backfillDocumentComments = defineRpc({
    name: "backfillDocumentComments",
    isIdempotent: true,
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        checkpoint: ServerSynchronizationCheckpointSchema,
        clientCommentCount: Schema.integer,
        newCommentLimit: Schema.integer,
    },
    output: {
        commentThread: DocumentCommentThreadModel.schema(),
        commentCount: Schema.integer,
        newComments: Schema.array(DocumentCommentModel.schema()),
        newOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
        commentUpdatesResult: createMessageUpdatesBackfillResultSchema(
            DocumentCommentModel.schema(),
        ),
    },
});

export const getDocumentCommentAtVersion = defineRpc({
    name: "getDocumentCommentAtVersion",
    isIdempotent: true,
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        commentIndex: Schema.integer,
        version: Schema.integer,
    },
    output: {
        comment: DocumentCommentModel.schema(),
    },
});

export const getDocumentCommentReferences = defineRpc({
    name: "getDocumentCommentReferences",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        documentId: Schema.id<DocumentId>(),
        referencedIds: MessageReferencedIdsSchema,
    },
    output: {
        references: MessageReferencesSchema,
    },
});

export const getOptimisticDocumentCommentReferences = defineRpc({
    name: "getOptimisticDocumentCommentReferences",
    isIdempotent: true,
    input: {
        spaceId: Schema.id<SpaceId>(),
        documentId: Schema.id<DocumentId>(),
        authorId: Schema.id<AccountId>(),
        contentReferencedIds: ContentReferencedIdsSchema,
        fileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),
    },
    output: {
        author: AccountModel.schema,
        contentReferences: ContentReferencesSchema,
        files: Schema.array(MessageContentPayloadModelFileSchema),
    },
});

export const getResolvedDocumentCommentThreadRanges = defineRpc({
    name: "getResolvedDocumentCommentThreadRanges",
    isIdempotent: true,
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
    },
    output: {
        version: Schema.integer,
        ranges: Schema.array(AddMarksAfterRemoveAllStepRangeSchema),
    },
});
