import {
    getContentReferences,
    getContentReferencesForNode,
} from "~/server/content/get_content_references.js";
import {
    FileDocumentAuthorizer,
    authorizeDocumentAccess,
    backfillDocumentComments,
    batchGetDocumentCommentThreadReferencesIfExists,
    confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency,
    createDocument,
    createDocumentComment,
    deleteDocumentComment,
    getDocument,
    getDocumentCommentThreadAndInitialCommentsIfExists,
    getDocumentCommentsFromEnd,
    getDocumentCommentsFromStart,
    getDocumentContentSteps,
    getDocumentPreviewIfExists,
    getResolvedDocumentCommentThreadRanges,
    updateDocumentCommentContent,
    updateDocumentContent,
} from "~/server/documents/data/documents_table.js";
import {attachFileAsUploader, attachFileFromAttachment} from "~/server/files/data/files_table.js";
import {getFileAttachmentTargetAuthorizer} from "~/server/rpc/files_rpc_implementations.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {emptyDocumentContent} from "~/shared/documents/document_content_schema.js";
import {DocumentCommentModel} from "~/shared/documents/document_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import * as definitions from "~/shared/rpc/documents_rpc_definitions.js";

export default implementRpcs(definitions, {
    authorizeDocumentAccess: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            await authorizeDocumentAccess(context.actor.authorizeSession(), input.documentId);
            return {};
        },
    },

    createDocument: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {id, createdTime} = await createDocument(context.actor.authorizeSession(), {
                id: input.documentId,
                spaceId: input.spaceId,
                content: emptyDocumentContent,
            });
            return {documentId: id, createdTime};
        },
    },

    getDocument: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            const document = await getDocument(context.actor.authorizeSession(), input.documentId);
            return {document};
        },
    },

    getDocumentPreviewIfExists: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            const documentPreview = await getDocumentPreviewIfExists(
                context.actor.authorizeSession(),
                input.documentId,
            );
            return {documentPreview};
        },
    },

    getDocumentContentSteps: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            const steps = await getDocumentContentSteps(context.actor.authorizeSession(), {
                id: input.documentId,
                startVersion: input.startVersion,
                endVersion: input.endVersion,
            });
            return {steps};
        },
    },

    updateDocumentContent: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            const {conflictingSteps, updatedCommentThreads} = await updateDocumentContent(
                context.actor.authorizeSession(),
                {
                    id: input.documentId,
                    version: input.version,
                    steps: input.steps,
                    clientId: input.clientId,
                    createCommentThreads: input.createCommentThreads,
                    resolveCommentThreadIds: input.resolveCommentThreadIds,
                    unresolveCommentThreadIds: input.unresolveCommentThreadIds,
                },
            );
            return {conflictingSteps, updatedCommentThreads};
        },
    },

    getDocumentContentReferences: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, {documentId, referencedIds}) => {
            const {spaceId} = await authorizeDocumentAccess(context, documentId);

            const [references, {commentThreadById, resolvedCommentThreadIds}] =
                await runAllPromises([
                    getContentReferences(
                        context,
                        spaceId,
                        FileDocumentAuthorizer.bind({type: "Document", documentId}),
                        referencedIds,
                    ),
                    referencedIds.commentThreadIds.size > 0
                        ? batchGetDocumentCommentThreadReferencesIfExists(context, {
                              documentId,
                              commentThreadIds: referencedIds.commentThreadIds,
                          })
                        : {
                              commentThreadById: new Map<never, never>(),
                              resolvedCommentThreadIds: new Set<never>(),
                          },
                ]);

            return {
                references: {
                    ...references,
                    commentThreadById,
                },
                resolvedCommentThreadIds,
            };
        },
    },

    confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            const confirmedCommentThreadIds =
                await confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency(
                    context,
                    input,
                );
            return {confirmedCommentThreadIds};
        },
    },

    getDocumentCommentThreadAndInitialCommentsIfExists: {
        visibility: ["DocumentCollaborationService"],
        execute: (context, input) => {
            return getDocumentCommentThreadAndInitialCommentsIfExists(
                context.actor.authorizeSession(),
                input,
            );
        },
    },

    getDocumentCommentsFromStart: {
        visibility: ["DocumentCollaborationService"],
        execute: (context, input) => {
            return getDocumentCommentsFromStart(context.actor.authorizeSession(), input);
        },
    },

    getDocumentCommentsFromEnd: {
        visibility: ["DocumentCollaborationService"],
        execute: (context, input) => {
            return getDocumentCommentsFromEnd(context.actor.authorizeSession(), input);
        },
    },

    createDocumentComment: {
        visibility: ["DocumentCollaborationService"],
        execute: async (unknownContext, input) => {
            const context = unknownContext.actor.authorizeSession();

            const {spaceId, index, createdTime} = await createDocumentComment(
                context.actor.authorizeSession(),
                input,
            );

            const [author, contentReferences] = await runAllPromises([
                getAccount(context, spaceId, context.actor.getAccountId()),
                getContentReferencesForNode(
                    context,
                    spaceId,
                    FileDocumentAuthorizer.bind({
                        type: "DocumentComment",
                        documentId: input.documentId,
                        commentThreadId: input.commentThreadId,
                        commentIndex: index,
                    }),
                    input.content,
                ),
            ]);

            const comment = new DocumentCommentModel({
                documentId: input.documentId,
                commentThreadId: input.commentThreadId,
                index,
                createdTime,
                author,
                payload: {
                    type: "Content",
                    parentMessageIndex: input.parentCommentIndex,
                    content: {
                        doc: input.content,
                        references: contentReferences,
                    },
                    contentUpdatedTime: null,
                },
            });

            return {comment};
        },
    },

    updateDocumentCommentContent: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            const [{contentUpdatedTime}, contentReferences] = await runAllPromises([
                updateDocumentCommentContent(context.actor.authorizeSession(), input),
                authorizeDocumentAccess(context.actor.authorizeSession(), input.documentId).then(
                    ({spaceId}) =>
                        getContentReferencesForNode(
                            context,
                            spaceId,
                            FileDocumentAuthorizer.bind({
                                type: "DocumentComment",
                                documentId: input.documentId,
                                commentThreadId: input.commentThreadId,
                                commentIndex: input.commentIndex,
                            }),
                            input.content,
                        ),
                ),
            ]);

            return {contentUpdatedTime, contentReferences};
        },
    },

    deleteDocumentComment: {
        visibility: ["DocumentCollaborationService"],
        execute: (context, input) => {
            return deleteDocumentComment(context.actor.authorizeSession(), input);
        },
    },

    backfillDocumentComments: {
        visibility: ["DocumentCollaborationService"],
        execute: (context, input) => {
            return backfillDocumentComments(context.actor.authorizeSession(), input);
        },
    },

    getOptimisticDocumentCommentReferences: {
        visibility: ["DocumentCollaborationService"],
        execute: async (
            context,
            {spaceId, documentId, commentThreadId, commentIndex, authorId, contentReferencedIds},
        ) => {
            const [author, contentReferences] = await runAllPromises([
                getAccount(context, spaceId, authorId),
                getContentReferences(
                    context,
                    spaceId,
                    FileDocumentAuthorizer.bind({
                        type: "DocumentComment",
                        documentId,
                        commentThreadId,
                        commentIndex,
                    }),
                    contentReferencedIds,
                ),
            ]);

            return {author, contentReferences};
        },
    },

    getResolvedDocumentCommentThreadRanges: {
        visibility: ["DocumentCollaborationService"],
        execute: (context, input) => {
            return getResolvedDocumentCommentThreadRanges(context, input);
        },
    },

    attachFilesToDocument: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            const {spaceId} = await authorizeDocumentAccess(context, input.documentId);

            await runAllPromises(
                input.files.map(async inputFile => {
                    switch (inputFile.source.type) {
                        case "Uploader": {
                            await attachFileAsUploader(
                                context,
                                spaceId,
                                inputFile.fileId,
                                FileDocumentAuthorizer.bind({
                                    type: "Document",
                                    documentId: input.documentId,
                                }),
                            );
                            break;
                        }
                        case "Attachment": {
                            await attachFileFromAttachment(context, spaceId, inputFile.fileId, {
                                from: getFileAttachmentTargetAuthorizer(inputFile.source.target),
                                to: FileDocumentAuthorizer.bind({
                                    type: "Document",
                                    documentId: input.documentId,
                                }),
                            });
                            break;
                        }
                        default:
                            throw exhaustive(inputFile.source);
                    }
                }),
            );

            return {};
        },
    },
});
