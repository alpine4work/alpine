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

/**
 * Our document collaboration WebSocket immediately sends steps to connected
 * clients as it receives them. But persistence happens at a slower pace.
 *
 * Don't tell the user that their changes have saved until you see a
 * `PersistedContent` message.
 */
const DocumentCollaborationUpdateContentWithoutPersistenceMessageFromServerSchema = Schema.object({
    type: Schema.value("UpdateContentWithoutPersistence"),
    newVersion: Schema.integer,
    steps: Schema.array(DocumentContentStepSchema),
    clientId: Schema.id,
    acknowledgeMessageId: Schema.id,
});

/**
 * Tells the client that we've successfully persisted all changes at this
 * version and if the client disconnects the changes will still be there.
 */
const DocumentCollaborationPersistedContentMessageFromServerSchema = Schema.object({
    type: Schema.value("PersistedContent"),
    newVersion: Schema.integer,
});

const DocumentCollaborationErrorMessageFromServerSchema = Schema.object({
    type: Schema.value("Error"),
    error: ErrorSchema,
});

export const DocumentCollaborationMessageFromServerSchema = Schema.union({
    BackfillResponse: DocumentCollaborationBackfillResponseMessageFromServerSchema,
    UpdateContentWithoutPersistence:
        DocumentCollaborationUpdateContentWithoutPersistenceMessageFromServerSchema,
    PersistedContent: DocumentCollaborationPersistedContentMessageFromServerSchema,
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
