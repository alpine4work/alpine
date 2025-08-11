import {getContentReferences} from "~/server/content/get_content_references.js";
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
    getDocumentContentForCollaborationServiceInitialization,
    getDocumentContentSteps,
    getDocumentPreviewIfExists,
    getResolvedDocumentCommentThreadRanges,
    updateDocumentCommentContent,
    updateDocumentContent,
} from "~/server/documents/data/documents_table.js";
import {getMessageContentPayloadModelFile} from "~/server/messaging/helpers/create_message_payload_model.js";
import {getMessageReferences} from "~/server/messaging/helpers/get_message_references.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import {authorizeSpaceAccess, getAccount} from "~/server/spaces/spaces_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import * as definitions from "~/shared/rpc/documents_rpc_definitions.js";

export default implementRpcs(definitions, {
    authorizeDocumentAccess: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            const {spaceId} = await authorizeDocumentAccess(
                context.actor.authorizeSession(),
                input.documentId,
                input.expectedAccessLevel,
            );

            if (input.withSpaceAccess) {
                await authorizeSpaceAccess(context, spaceId);
            }

            return {};
        },
    },

    createDocument: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const {id, createdTime} = await createDocument(context.actor.authorizeSession(), {
                id: input.documentId,
                spaceId: input.spaceId,
            });
            return {documentId: id, createdTime};
        },
    },

    getDocument: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const document = await getDocument(context.actor.authorizeSession(), input.documentId);
            return {document};
        },
    },

    getDocumentContentForCollaborationServiceInitialization: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            const {spaceId, version, content} =
                await getDocumentContentForCollaborationServiceInitialization(
                    context.actor.authorizeSession(),
                    input.documentId,
                );
            return {spaceId, version, content};
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
                    intentionallyUpdateAccessPolicy: input.intentionallyUpdateAccessPolicy,
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
            const {spaceId} = await authorizeDocumentAccess(context, documentId, "View");

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

            const {index, createdTime} = await createDocumentComment(
                context.actor.authorizeSession(),
                input,
            );

            return {index, createdTime};
        },
    },

    updateDocumentCommentContent: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, input) => {
            const {contentUpdatedTime} = await updateDocumentCommentContent(
                context.actor.authorizeSession(),
                input,
            );
            return {contentUpdatedTime};
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

    getDocumentCommentReferences: {
        visibility: ["DocumentCollaborationService"],
        execute: async (context, {spaceId, documentId, referencedIds}) => {
            const references = await getMessageReferences(
                context.actor.authorizeSession(),
                spaceId,
                FileDocumentAuthorizer.bind({type: "DocumentComments", documentId}),
                referencedIds,
            );
            return {references};
        },
    },

    getOptimisticDocumentCommentReferences: {
        visibility: ["DocumentCollaborationService"],
        execute: async (
            context,
            {spaceId, documentId, authorId, contentReferencedIds, fileIds},
        ) => {
            const fileAuthorizer = FileDocumentAuthorizer.bind({
                type: "DocumentComments",
                documentId,
            });

            const [author, contentReferences, files] = await runAllPromises([
                getAccount(context, spaceId, authorId),
                getContentReferences(context, spaceId, "AssertHasNoFiles", contentReferencedIds),
                runAllPromises(
                    mapIterable(fileIds, fileId =>
                        getMessageContentPayloadModelFile(context, spaceId, fileAuthorizer, fileId),
                    ),
                ),
            ]);

            return {author, contentReferences, files};
        },
    },

    getResolvedDocumentCommentThreadRanges: {
        visibility: ["DocumentCollaborationService"],
        execute: (context, input) => {
            return getResolvedDocumentCommentThreadRanges(context, input);
        },
    },
});
