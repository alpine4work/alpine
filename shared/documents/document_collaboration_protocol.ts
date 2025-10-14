import {AccessPolicySchema} from "~/shared/access/access_policy.js";
import {ShareNotificationSchema} from "~/shared/access/share_notification.js";
import {ContentSelectionSchema} from "~/shared/content/content_selection_schema.js";
import {DocumentContentReferencesSchema} from "~/shared/documents/document_content_references.js";
import {DocumentContentStepSchema} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
} from "~/shared/documents/document_model.js";
import {createDynamoGeneralRealtimeEventSchema} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {
    ContentEditorClientId,
    DocumentCommentThreadId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.js";
import {MessageChangeSchema} from "~/shared/messaging/message_change_schema.js";
import {MessageContentSchema} from "~/shared/messaging/message_content_schema.js";
import {
    MessagingTypingStateSchema,
    createMessagingRealtimeEventSchemas,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type DocumentCollaborationPresenceState = SchemaType<
    typeof DocumentCollaborationPresenceStateSchema
>;

const DocumentCollaborationPresenceStateSchema = Schema.object({
    version: Schema.integer,
    selection: ContentSelectionSchema,
});

export type DocumentCollaborationEvent = WebSocketProtocolEventType<
    typeof DocumentCollaborationProtocol
>;

export const DocumentCollaborationProtocol = defineWebSocketProtocol({
    procedures: {
        /**
         * Request a backfill to catch us up from the version our client loaded from
         * the server to the latest, live, document version.
         *
         * Even if the client just loaded a document in the milliseconds between the
         * server returning the document and the client connecting to the collaboration
         * service there may have been an update.
         */
        backfill: {
            input: {
                version: Schema.integer,
            },
            output: {
                newVersion: Schema.integer,
                persistedVersion: Schema.integer,
                steps: Schema.array(
                    Schema.object({
                        step: DocumentContentStepSchema,
                        clientId: Schema.id<ContentEditorClientId>(),
                    }),
                ),
                stepsContentReferences: DocumentContentReferencesSchema,
                presenceStates: Schema.array(
                    Schema.object({
                        connectionId: Schema.id<WebSocketConnectionId>(),
                        state: DocumentCollaborationPresenceStateSchema,
                    }),
                ),
                rememberInvertedSteps: Schema.array(DocumentContentStepSchema),
            },
        },

        updateContent: {
            input: {
                version: Schema.integer,
                steps: Schema.array(DocumentContentStepSchema),
                clientId: Schema.id<ContentEditorClientId>(),
                createCommentThreads: Schema.array(
                    Schema.object({
                        commentThreadId: Schema.id<DocumentCommentThreadId>(),
                        initialCommentContent: MessageContentSchema,
                        initialCommentFileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),
                    }),
                ),
                intentionallyUpdateAccessPolicy: Schema.object({
                    accessPolicy: AccessPolicySchema,
                    notification: ShareNotificationSchema.nullable(),
                })
                    .nullable()
                    .default(null),
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
            },
            output: {},
        },

        updateOurPresenceState: {
            input: {
                state: DocumentCollaborationPresenceStateSchema.nullable(),
            },
            output: {},
        },

        /** See `backfillMessages` in `messaging_realtime_protocol.ts`. */
        backfillComments: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                clientCommentCount: Schema.integer,
                clientLastCommentChangeTime: Schema.date.nullable(),
                newCommentLimit: Schema.integer,
            },
            output: {
                commentThread: DocumentCommentThreadModel.schema(),
                commentCount: Schema.integer,
                lastCommentChangeTime: Schema.date.nullable(),
                newComments: Schema.array(DocumentCommentModel.schema()),
                newOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
                commentChangesResult: Schema.union({
                    Available: Schema.object({
                        type: Schema.value("Available"),
                        changes: Schema.array(MessageChangeSchema),
                    }),
                    Unavailable: Schema.object({
                        type: Schema.value("Unavailable"),
                    }),
                }),
                typingStateByConnectionId: Schema.map(
                    Schema.id<WebSocketConnectionId>(),
                    MessagingTypingStateSchema,
                ),
            },
        },

        /** See `createMessage` in `messaging_realtime_protocol.ts`. */
        createComment: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                parentCommentIndex: Schema.integer.nullable(),
                content: MessageContentSchema,
                fileIds: Schema.array(FileIdOrFileEntityIdSchema),
            },
            output: {},
        },

        /** See `updateMessageContent` in `messaging_realtime_protocol.ts`. */
        updateCommentContent: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                commentIndex: Schema.integer,
                content: MessageContentSchema,
            },
            output: {},
        },

        /** See `deleteMessage` in `messaging_realtime_protocol.ts`. */
        deleteComment: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                commentIndex: Schema.integer,
            },
            output: {},
        },

        /** See `startTypingInCommentInput` in `messaging_realtime_protocol.ts`. */
        startTypingInCommentInput: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
            },
            output: {},
        },

        /** See `stopTypingInCommentInput` in `messaging_realtime_protocol.ts`. */
        stopTypingInCommentInput: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
            },
            output: {},
        },

        /**
         * Get a comment thread and its associated initial comments.
         *
         * This is a part of our collaboration WebSocket protocol because we may have
         * an optimistic comment thread created in the durable object that hasn't been
         * persisted yet.
         */
        getCommentThreadAndInitialCommentsIfExists: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                limit: Schema.integer,
            },
            output: {
                commentThread: DocumentCommentThreadModel.schema().nullable(),
                initialComments: Schema.array(DocumentCommentModel.schema()),
                initialOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
            },
        },

        /**
         * Get some comments in a comment thread.
         *
         * This is a part of our collaboration WebSocket protocol because we may have
         * an optimistic comment thread created in the durable object that hasn't been
         * persisted yet.
         */
        getCommentsFromStart: {
            input: {
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
        },

        /**
         * Get some comments in a comment thread.
         *
         * This is a part of our collaboration WebSocket protocol because we may have
         * an optimistic comment thread created in the durable object that hasn't been
         * persisted yet.
         */
        getCommentsFromEnd: {
            input: {
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
        },

        /**
         * Marks a document comment thread as resolved and removes any instances of the
         * comment mark in the document. If the comment thread is already resolved then
         * this does nothing.
         */
        resolveCommentThread: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
            },
            output: {},
        },

        /**
         * Marks a document comment thread as unresolved. Adds the comment mark back to
         * the document everywhere it was previously. If the comment thread is already
         * unresolved then this does nothing.
         */
        unresolveCommentThread: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
            },
            output: {},
        },
    },
    events: {
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
            stepsContentReferences: DocumentContentReferencesSchema,
            clientId: Schema.id<ContentEditorClientId>(),

            /**
             * Atomically update this other presence state in the same action as we update
             * content.
             *
             * If null then we aren't updating any presence state.
             */
            updateOtherPresenceState: Schema.object({
                connectionId: Schema.id<WebSocketConnectionId>(),
                state: DocumentCollaborationPresenceStateSchema.nullable(),
            }).nullable(),

            /**
             * Comment threads that were resolved at the same time as these steps were
             * applied. Remember that when you receive this event we may not have persisted
             * the resolve state yet! You'll get the newly persisted
             * `DocumentCommentThreadModel` object with `PersistedContent`.
             */
            resolveCommentThreadIds: Schema.array(Schema.id<DocumentCommentThreadId>()),

            /**
             * Comment threads that were unresolved at the same time as these steps were
             * applied. Remember that when you receive this event we may not have persisted
             * the resolve state yet! You'll get the newly persisted
             * `DocumentCommentThreadModel` object with `PersistedContent`.
             */
            unresolveCommentThreadIds: Schema.array(Schema.id<DocumentCommentThreadId>()),
        }),

        /**
         * Tells the client that we've successfully persisted all changes at this
         * version and if the client disconnects the changes will still be there.
         *
         * You may get a `PersistedContent` event before a
         * `UpdateContentWithoutPersistence` with the steps for this version. That's
         * because we need to load references from the database before we can send
         * `UpdateContentWithoutPersistence` and persistence may happen before that.
         */
        PersistedContent: Schema.object({
            type: Schema.value("PersistedContent"),
            newVersion: Schema.integer,
            updatedCommentThreads: Schema.array(DocumentCommentThreadModel.schema()),
        }),

        UpdateOtherPresenceState: Schema.object({
            type: Schema.value("UpdateOtherPresenceState"),
            connectionId: Schema.id<WebSocketConnectionId>(),
            state: DocumentCollaborationPresenceStateSchema.nullable(),
        }),

        // TODO(calebmer): This is a leftover artifact from before I introduced the
        // `ClosingWithError` message to our WebSocket server protocol. I think we
        // could refactor this to remove this event and call `closeWithError()`
        // instead.
        Error: Schema.object({
            type: Schema.value("Error"),
            error: ErrorSchema,
        }),

        // NOTE(calebmer): Code-style note. We want top-level procedure/event names to
        // use the correct nomenclature for posts. We call "messages" "comments" in a
        // document context. We are ok nesting an event with "message" nomenclature in
        // an event with the name `Comments` but we can't nest procedures hence why we
        // need to write them out from scratch.
        //
        // Was it correct to "comment" as the name in code for document comments?
        // Probably not. All the boilerplate is pretty unnecessary.
        Comments: Schema.object({
            type: Schema.value("Comments"),
            commentThreadId: Schema.id<DocumentCommentThreadId>(),
            event: Schema.union(createMessagingRealtimeEventSchemas(DocumentCommentModel.schema())),
        }),

        SpellCheckRealtimeEventTransaction: Schema.object({
            type: Schema.value("SpellCheckRealtimeEventTransaction"),
            readTime: Schema.date,
            eventTransaction: Schema.array(
                createDynamoGeneralRealtimeEventSchema(SpellCheckIgnoredLintModel.schema()),
            ),
        }),
    },
});
