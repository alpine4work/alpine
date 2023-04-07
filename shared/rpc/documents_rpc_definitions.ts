import {DocumentContentStepSchema} from "~/shared/content/document_content_schema";
import {
    ContentEditorClientId,
    DocumentCommentThreadId,
    DocumentId,
} from "~/shared/id/types/id_types";
import {DocumentCommentModel, DocumentCommentThreadModel} from "~/shared/models/document_model";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const getDocumentContentSteps = defineRpc({
    name: "getDocumentContentSteps",
    input: {
        id: Schema.id<DocumentId>(),
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

export const getDocumentCommentThreadAndInitialComments = defineRpc({
    name: "getDocumentCommentThreadAndInitialComments",
    input: {
        documentId: Schema.id<DocumentId>(),
        commentThreadId: Schema.id<DocumentCommentThreadId>(),
        limit: Schema.integer,
    },
    output: {
        commentThread: DocumentCommentThreadModel.schema(),
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
