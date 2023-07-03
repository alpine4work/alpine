import {getAccount} from "~/server/dynamo/accounts_table.js";
import {
    authorizeDocumentAccess,
    backfillDocumentComments,
    createDocumentComment,
    deleteDocumentComment,
    getDocument,
    getDocumentCommentThreadAndInitialComments,
    getDocumentCommentsFromEnd,
    getDocumentCommentsFromStart,
    getDocumentContentSteps,
    getDocumentPreviewIfExists,
    updateDocumentCommentContent,
    updateDocumentContent,
} from "~/server/dynamo/documents_table.js";
import {
    getContentReferences,
    getContentReferencesForNode,
} from "~/server/dynamo/helpers/get_content_references.js";
import {getDocumentContentReferences} from "~/server/dynamo/helpers/get_document_content_references.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
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
        const {conflictingSteps} = await updateDocumentContent(context.actor.authorizeSession(), {
            id: input.documentId,
            version: input.version,
            steps: input.steps,
            clientId: input.clientId,
            createCommentThreads: input.createCommentThreads,
        });
        return {conflictingSteps};
    },
);

implementRpc(
    definition.getDocumentContentReferences,
    {visibility: ["DocumentCollaborationService"]},
    async (context, input) => {
        const references = await getDocumentContentReferences(
            context.actor.authorizeSession(),
            input.documentId,
            input.referencedIds,
        );
        return {references};
    },
);

implementRpc(
    definition.getDocumentCommentThreadAndInitialComments,
    {visibility: ["DocumentCollaborationService"]},
    (context, input) => {
        return getDocumentCommentThreadAndInitialComments(context.actor.authorizeSession(), input);
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

        const [{index, createdTime}, author, contentReferences] = await runAllPromises([
            createDocumentComment(context.actor.authorizeSession(), input),
            context.actor.getAccount(),
            authorizeDocumentAccess(context, input.documentId).then(({spaceId}) =>
                getContentReferencesForNode(context, spaceId, input.content),
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
