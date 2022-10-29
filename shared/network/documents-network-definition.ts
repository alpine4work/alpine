import {
    DocumentContentSchema,
    DocumentContentStepSchema,
} from "~/shared/documents/document-content-schema";
import {defineNetworkChannel} from "~/shared/network/internal/define-network-channel";
import {defineNetworkFunction} from "~/shared/network/internal/define-network-function";
import {defineNetworkPresenceChannel} from "~/shared/network/internal/define-network-presence-channel";
import {Schema} from "~/shared/schema/schema";

export const createDocument = defineNetworkFunction({
    name: "createDocument",
    input: {
        id: Schema.id,
        content: DocumentContentSchema,
    },
    output: {},
});

export const DocumentEditorPresenceUpdateSchema = Schema.object({
    presenceStateKey: Schema.string,
    /**
     * Null means the client left the presence channel.
     */
    presenceState: Schema.object({
        version: Schema.integer,
        textSelection: Schema.object({
            anchor: Schema.integer,
            head: Schema.integer,
        }).nullable(),
    }),
});

export const updateDocumentContent = defineNetworkFunction({
    name: "updateDocumentContent",
    input: {
        id: Schema.id,
        version: Schema.integer,
        steps: Schema.array(DocumentContentStepSchema),
        clientId: Schema.id,
        editorPresenceUpdate: DocumentEditorPresenceUpdateSchema.optional(),
    },
    output: {
        newVersion: Schema.integer,
        newSteps: Schema.array(DocumentContentStepSchema),
        conflictingSteps: Schema.array(
            Schema.object({
                step: DocumentContentStepSchema,
                clientId: Schema.id,
            }),
        ),
        newEditorPresenceUpdate: DocumentEditorPresenceUpdateSchema.nullable(),
    },
});

export const readDocumentContentSteps = defineNetworkFunction({
    name: "readDocumentContentSteps",
    input: {
        id: Schema.id,
        startVersion: Schema.integer,
        endVersion: Schema.integer,
    },
    output: {
        steps: Schema.array(
            Schema.object({
                step: DocumentContentStepSchema,
                invertedStep: DocumentContentStepSchema,
                clientId: Schema.id,
            }),
        ),
    },
});

export const DocumentChannel = defineNetworkChannel({
    name: "Document",
    key: {
        documentId: Schema.id,
    },
    messages: {
        UpdateContent: Schema.object({
            type: Schema.value("UpdateContent"),
            newVersion: Schema.integer,
            steps: Schema.array(DocumentContentStepSchema),
            clientId: Schema.id,
            /**
             * As an optimization, we include a presence update the should have been
             * messaged on `DocumentEditorPresenceChannel` when we update content. This
             * allows:
             *
             * 1. Clients to atomically update the presence state of the person typing with
             *    their change to the document.
             * 2. Reduced number of messages sent by Ably. Already every client needs to
             *    send/receive an `UpdateContent` message so it would cost us double to
             *    also send a presence update.
             *
             * Null does not mean "the client has left" but rather "there was not a
             * presence update associated with this message".
             *
             * This is a little unfortunate from a permissions perspective. In order to
             * subscribe to the editor presence channel you must be an editor on the
             * document. But here we share editor presence information with everyone who
             * has read access to a document.
             *
             * This is fine. The user's selection when they update content will always be
             * around the content they updated. So we're generally not revealing new
             * information here.
             */
            editorPresenceUpdate: DocumentEditorPresenceUpdateSchema.nullable(),
        }),
    },
});

export const DocumentEditorPresenceChannel = defineNetworkPresenceChannel({
    name: "DocumentEditorPresence",
    key: {
        documentId: Schema.id,
    },
    state: {
        version: Schema.integer,
        textSelection: Schema.object({
            anchor: Schema.integer,
            head: Schema.integer,
        }),
    },
});
