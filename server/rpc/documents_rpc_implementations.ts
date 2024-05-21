import {
    getContentReferences,
    getContentReferencesForNode,
} from "~/server/content/get_content_references.js";
import {
    authorizeDocumentAccess,
    backfillDocumentComments,
    batchGetDocumentCommentThreadReferencesIfExists,
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
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {emptyDocumentContent} from "~/shared/documents/document_content_schema.js";
import {DocumentCommentModel} from "~/shared/documents/document_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import * as definition from "~/shared/rpc/documents_rpc_definitions.js";

implementRpc(
    definition.authorizeDocumentAccess,
    {visibility: ["DocumentCollaborationService"]},
    async (context, input) => {
        await authorizeDocumentAccess(context.actor.authorizeSession(), input.documentId);
        return {};
    },
);

implementRpc(definition.createDocument, {visibility: ["AppClient"]}, async (context, input) => {
    const {id, createdTime} = await createDocument(context.actor.authorizeSession(), {
        id: input.documentId,
        spaceId: input.spaceId,
        content: emptyDocumentContent,
    });

    return {documentId: id, createdTime};
});

implementRpc(
    definition.getDocument,
    {visibility: ["DocumentCollaborationService"]},
    async (context, input) => {
        const document = await getDocument(context.actor.authorizeSession(), input.documentId);
        return {document};
    },
);

implementRpc(
    definition.getDocumentPreviewIfExists,
    {visibility: ["DocumentCollaborationService"]},
    async (context, input) => {
        const documentPreview = await getDocumentPreviewIfExists(
            context.actor.authorizeSession(),
            input.documentId,
        );
        return {documentPreview};
    },
);

implementRpc(
    definition.getDocumentContentSteps,
    {visibility: ["DocumentCollaborationService"]},
    async (context, input) => {
        const steps = await getDocumentContentSteps(context.actor.authorizeSession(), {
            id: input.documentId,
            startVersion: input.startVersion,
            endVersion: input.endVersion,
        });
        return {steps};
    },
);

implementRpc(
    definition.updateDocumentContent,
    {visibility: ["DocumentCollaborationService"]},
    async (context, input) => {
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
);

implementRpc(
    definition.getDocumentContentReferences,
    {visibility: ["DocumentCollaborationService"]},
    async (context, {documentId, referencedIds}) => {
        const {spaceId} = await authorizeDocumentAccess(context, documentId);

        const [references, commentThreadById] = await runAllPromises([
            getContentReferences(context, spaceId, referencedIds),
            referencedIds.commentThreadIds.size > 0
                ? batchGetDocumentCommentThreadReferencesIfExists(context, {
                      documentId,
                      commentThreadIds: referencedIds.commentThreadIds,
                  })
                : new Map(),
        ]);

        return {
            references: {
                ...references,
                commentThreadById,
            },
        };
    },
);

implementRpc(
    definition.getDocumentCommentThreadAndInitialCommentsIfExists,
    {visibility: ["DocumentCollaborationService"]},
    (context, input) => {
        return getDocumentCommentThreadAndInitialCommentsIfExists(
            context.actor.authorizeSession(),
            input,
        );
    },
);

implementRpc(
    definition.getDocumentCommentsFromStart,
    {visibility: ["DocumentCollaborationService"]},
    (context, input) => {
        return getDocumentCommentsFromStart(context.actor.authorizeSession(), input);
    },
);

implementRpc(
    definition.getDocumentCommentsFromEnd,
    {visibility: ["DocumentCollaborationService"]},
    (context, input) => {
        return getDocumentCommentsFromEnd(context.actor.authorizeSession(), input);
    },
);

implementRpc(
    definition.createDocumentComment,
    {visibility: ["DocumentCollaborationService"]},
    async (unknownContext, input) => {
        const context = unknownContext.actor.authorizeSession();

        const [{index, createdTime}, [author, contentReferences]] = await runAllPromises([
            createDocumentComment(context.actor.authorizeSession(), input),
            authorizeDocumentAccess(context, input.documentId).then(({spaceId}) =>
                runAllPromises([
                    getAccount(context, spaceId, context.actor.getAccountId()),
                    getContentReferencesForNode(context, spaceId, input.content),
                ]),
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
);

implementRpc(
    definition.updateDocumentCommentContent,
    {visibility: ["DocumentCollaborationService"]},
    async (context, input) => {
        const [{contentUpdatedTime}, contentReferences] = await runAllPromises([
            updateDocumentCommentContent(context.actor.authorizeSession(), input),
            authorizeDocumentAccess(context.actor.authorizeSession(), input.documentId).then(
                ({spaceId}) => getContentReferencesForNode(context, spaceId, input.content),
            ),
        ]);

        return {contentUpdatedTime, contentReferences};
    },
);

implementRpc(
    definition.deleteDocumentComment,
    {visibility: ["DocumentCollaborationService"]},
    (context, input) => {
        return deleteDocumentComment(context.actor.authorizeSession(), input);
    },
);

implementRpc(
    definition.backfillDocumentComments,
    {visibility: ["DocumentCollaborationService"]},
    (context, input) => {
        return backfillDocumentComments(context.actor.authorizeSession(), input);
    },
);

implementRpc(
    definition.getOptimisticDocumentCommentReferences,
    {visibility: ["DocumentCollaborationService"]},
    async (context, input) => {
        const [author, contentReferences] = await runAllPromises([
            getAccount(context, input.spaceId, input.authorId),
            getContentReferences(context, input.spaceId, input.contentReferencedIds),
        ]);

        return {author, contentReferences};
    },
);

implementRpc(
    definition.getResolvedDocumentCommentThreadRanges,
    {visibility: ["DocumentCollaborationService"]},
    (context, input) => {
        return getResolvedDocumentCommentThreadRanges(context, input);
    },
);
