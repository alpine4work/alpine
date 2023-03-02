import {DocumentContentStepSchema} from "~/shared/content/document_content_schema";
import {ErrorSchema} from "~/shared/error/error_schema";
import {ContentEditorClientId, WebSocketConnectionId} from "~/shared/id/types/id_types";
import {ContentReferencesSchema} from "~/shared/models/content_references";
import {ProsemirrorSelectionSchema} from "~/shared/prosemirror/prosemirror_selection_schema";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type DocumentCollaborationPresenceState = SchemaType<
    typeof DocumentCollaborationPresenceStateSchema
>;

const DocumentCollaborationPresenceStateSchema = Schema.object({
    version: Schema.integer,
    selection: ProsemirrorSelectionSchema,
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
        clientId: Schema.id<ContentEditorClientId>(),
        /**
         * Atomically update our presence state in the same action as we update
         * our content.
         *
         * The state must have a `version` that matches the `version` in this update.
         * However, an important detail is that the state is for the document at
         * `version` plus the `steps` in this update! The selection, for instance, is
         * for the document after steps are applied.
         *
         * The presence state in `UpdateOurPresenceState` is for exactly the referenced
         * document version.
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
                clientId: Schema.id<ContentEditorClientId>(),
            }),
        ),
        stepsContentReferences: ContentReferencesSchema,
        presenceStates: Schema.array(
            Schema.object({
                connectionId: Schema.id<WebSocketConnectionId>(),
                state: DocumentCollaborationPresenceStateSchema,
            }),
        ),
        rememberInvertedSteps: Schema.array(DocumentContentStepSchema),
    }),
    /**
     * Our document collaboration WebSocket immediately sends steps to connected
     * clients as it receives them. But persistence happens at a slower pace.
     *
     * Don't tell the user that their changes have saved until you see a
     * `PersistedContent` message.
     *
     * You have no ordering guarantees around this message! Usually you will get
     * these messages in ascending version order and usually this message will
     * occur before the `PersistedContent` message for the same version. However,
     * usually is the operative word! We can not send this message until we load
     * `ContentReferences` and loading `ContentReferences` does not block other
     * updates. So client implementations need to handle receiving this message
     * out-of-order. A recommend implementation is if you get a future message, put
     * it in a queue until you get earlier messages needed to process it.
     */
    UpdateContentWithoutPersistence: Schema.object({
        type: Schema.value("UpdateContentWithoutPersistence"),
        newVersion: Schema.integer,
        steps: Schema.array(DocumentContentStepSchema),
        stepsContentReferences: ContentReferencesSchema,
        clientId: Schema.id<ContentEditorClientId>(),
        /**
         * Atomically update this other presence state in the same action as we update
         * content.
         */
        updateOtherPresenceState: Schema.object({
            connectionId: Schema.id<WebSocketConnectionId>(),
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
        connectionId: Schema.id<WebSocketConnectionId>(),
        state: DocumentCollaborationPresenceStateSchema.nullable(),
    }),
    Error: Schema.object({
        type: Schema.value("Error"),
        error: ErrorSchema,
    }),
});
