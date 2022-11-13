import {DocumentContentStepSchema} from "~/shared/documents/document_content_schema";
import {ErrorSchema} from "~/shared/error/error_schema";
import {Schema, SchemaType} from "~/shared/schema/schema";

export const DocumentCollaborationCommittedStepSchema = Schema.object({
    step: DocumentContentStepSchema,
    version: Schema.integer,
});
export type DocumentCollaborationCommittedStep = SchemaType<
    typeof DocumentCollaborationCommittedStepSchema
>;

/* ========================================================================== *\
 * Messages from server                                                       *
\* ========================================================================== */

const DocumentCollaborationBackfillResponseMessageFromServerSchema = Schema.object({
    type: Schema.value("BackfillResponse"),
    newVersion: Schema.integer,
    steps: Schema.array(
        Schema.object({
            step: DocumentContentStepSchema,
            clientId: Schema.id,
        }),
    ),
});

const DocumentCollaborationUpdateContentMessageFromServerSchema = Schema.object({
    type: Schema.value("UpdateContent"),
    newVersion: Schema.integer,
    steps: Schema.array(DocumentContentStepSchema),
    clientId: Schema.id,
    acknowledgeMessageId: Schema.id,
});

const DocumentCollaborationErrorMessageFromServerSchema = Schema.object({
    type: Schema.value("Error"),
    error: ErrorSchema,
});

export const DocumentCollaborationMessageFromServerSchema = Schema.union({
    BackfillResponse: DocumentCollaborationBackfillResponseMessageFromServerSchema,
    UpdateContent: DocumentCollaborationUpdateContentMessageFromServerSchema,
    Error: DocumentCollaborationErrorMessageFromServerSchema,
});
export type DocumentCollaborationMessageFromServer = SchemaType<
    typeof DocumentCollaborationMessageFromServerSchema
>;

/* ========================================================================== *\
 * Messages from client                                                       *
\* ========================================================================== */

const DocumentCollaborationBackfillRequestMessageFromClientSchema = Schema.object({
    type: Schema.value("BackfillRequest"),
    version: Schema.integer,
});

export const DocumentCollaborationUpdateContentMessageFromClientSchema = Schema.object({
    type: Schema.value("UpdateContent"),
    version: Schema.integer,
    steps: Schema.array(DocumentContentStepSchema),
    clientId: Schema.id,
    // NOTE(calebmer): I wonder if message id should be a part of the
    // `WebSocketServer` abstraction?
    messageId: Schema.id,
});

export const DocumentCollaborationMessageFromClientSchema = Schema.union({
    BackfillRequest: DocumentCollaborationBackfillRequestMessageFromClientSchema,
    UpdateContent: DocumentCollaborationUpdateContentMessageFromClientSchema,
});
export type DocumentCollaborationMessageFromClient = SchemaType<
    typeof DocumentCollaborationMessageFromClientSchema
>;
