import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {ContentEditorClientId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {
    TaskNotesContentSchema,
    TaskNotesContentStepSchema,
} from "~/shared/tasks/task_notes_content_schema.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type TaskNotesCollaborationEvent = WebSocketProtocolEventType<
    typeof TaskNotesCollaborationProtocol
>;

export const TaskNotesCollaborationProtocol = defineWebSocketProtocol({
    procedures: {
        /**
         * Request a backfill to catch us up from the version our client loaded from
         * the server to the latest, live, task notes version.
         *
         * Even if the client just loaded notes in the milliseconds between the
         * server returning the notes and the client connecting to the collaboration
         * service there may have been an update.
         *
         * If the client is way behind, a step backfill may be unavailable and the
         * client will need to fully reset its content. Losing any local steps in the
         * process.
         */
        backfill: {
            input: {
                version: Schema.integer,
            },
            output: {
                result: Schema.union({
                    Available: Schema.object({
                        type: Schema.value("Available"),
                        newVersion: Schema.integer,
                        steps: Schema.array(
                            Schema.object({
                                step: TaskNotesContentStepSchema,
                                clientId: Schema.id<ContentEditorClientId>(),
                            }),
                        ),
                        stepsContentReferences: ContentReferencesSchema,
                    }),
                    Unavailable: Schema.object({
                        type: Schema.value("Unavailable"),
                        newVersion: Schema.integer,
                        content: TaskNotesContentSchema,
                        contentReferences: ContentReferencesSchema,
                    }),
                }),
            },
        },

        updateContent: {
            input: {
                version: Schema.integer,
                steps: Schema.array(TaskNotesContentStepSchema),
                clientId: Schema.id<ContentEditorClientId>(),
            },
            output: {},
        },
    },
    events: {
        /**
         * Our task notes collaboration WebSocket immediately sends steps to connected
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
            steps: Schema.array(TaskNotesContentStepSchema),
            stepsContentReferences: ContentReferencesSchema,
            clientId: Schema.id<ContentEditorClientId>(),
        }),

        /**
         * Tells the client that we've successfully persisted all changes at this
         * version and if the client disconnects the changes will still be there.
         */
        PersistedContent: Schema.object({
            type: Schema.value("PersistedContent"),
            newVersion: Schema.integer,
        }),
    },
});
