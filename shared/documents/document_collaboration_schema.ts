import {DocumentContentStepSchema} from "~/shared/documents/document_content_schema";
import {ErrorSchema} from "~/shared/error/error_schema";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type DocumentCollaborationPresenceState = SchemaType<
    typeof DocumentCollaborationPresenceStateSchema
>;

const DocumentCollaborationPresenceStateSchema = Schema.object({
    version: Schema.integer,
    textSelection: Schema.object({
        anchor: Schema.integer,
        head: Schema.integer,
    }),
});

export type DocumentCollaborationMessageFromClient = SchemaType<
    typeof DocumentCollaborationMessageFromClientSchema
>;

export const DocumentCollaborationMessageFromClientSchema = Schema.union({
    BackfillRequest: Schema.object({
        type: Schema.value("BackfillRequest"),
        version: Schema.integer,
    }),
    UpdateContent: Schema.object({
        type: Schema.value("UpdateContent"),
        version: Schema.integer,
        steps: Schema.array(DocumentContentStepSchema),
        clientId: Schema.id,
        // NOTE(calebmer): I wonder if message id should be a part of the
        // `WebSocketServer` abstraction?
        messageId: Schema.id,
        /**
         * Atomically update our presence state in the same action as we update
         * our content.
         */
        updateOurPresenceState: Schema.object({
            state: DocumentCollaborationPresenceStateSchema.nullable(),
        }),
    }),
    UpdateOurPresenceState: Schema.object({
        type: Schema.value("UpdateOurPresenceState"),
        state: DocumentCollaborationPresenceStateSchema.nullable(),
    }),
});

export type DocumentCollaborationMessageFromServer = SchemaType<
    typeof DocumentCollaborationMessageFromServerSchema
>;

export const DocumentCollaborationMessageFromServerSchema = Schema.union({
    BackfillResponse: Schema.object({
        type: Schema.value("BackfillResponse"),
        newVersion: Schema.integer,
        steps: Schema.array(
            Schema.object({
                step: DocumentContentStepSchema,
                clientId: Schema.id,
            }),
        ),
        presenceStates: Schema.array(
            Schema.object({
                connectionId: Schema.id,
                state: DocumentCollaborationPresenceStateSchema,
            }),
        ),
    }),
    /**
     * Our document collaboration WebSocket immediately sends steps to connected
     * clients as it receives them. But persistence happens at a slower pace.
     *
     * Don't tell the user that their changes have saved until you see a
     * `PersistedContent` message.
     */
    UpdateContentBeforePersistence: Schema.object({
        type: Schema.value("UpdateContentBeforePersistence"),
        newVersion: Schema.integer,
        steps: Schema.array(DocumentContentStepSchema),
        clientId: Schema.id,
        acknowledgeMessageId: Schema.id,
        /**
         * Atomically update this other presence state in the same action as we update
         * content.
         */
        updateOtherPresenceState: Schema.object({
            connectionId: Schema.id,
            state: DocumentCollaborationPresenceStateSchema.nullable(),
        }),
    }),
    /**
     * Tells the client that we've successfully persisted all changes at this
     * version and if the client disconnects the changes will still be there.
     */
    PersistedContent: Schema.object({
        type: Schema.value("PersistedContent"),
        newVersion: Schema.integer,
    }),
    UpdateOtherPresenceState: Schema.object({
        type: Schema.value("UpdateOtherPresenceState"),
        connectionId: Schema.id,
        state: DocumentCollaborationPresenceStateSchema.nullable(),
    }),
    Error: Schema.object({
        type: Schema.value("Error"),
        error: ErrorSchema,
    }),
});
