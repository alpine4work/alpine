import {LocalAccessPolicySchema} from "~/shared/access/access_policy.js";
import {CreateOrUpdateAccessPolicySchema} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {ShareNotificationSchema} from "~/shared/access/share_notification.js";
import type {ApiContentKey} from "~/shared/api/specification/types/api_content_key.open_source.js";
import {ContentSelectionSchema} from "~/shared/content/content_selection_schema.js";
import {
    MessageContentSchema,
    MessageContentStepSchema,
} from "~/shared/content/message_content_schema.js";
import {DocumentContentReferencesSchema} from "~/shared/documents/document_content_references.js";
import {
    DocumentContentNodeSchema,
    DocumentContentSchema,
    DocumentContentStepSchema,
} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
} from "~/shared/documents/document_model.js";
import {createRynamoEventSchema} from "~/shared/dynamo/rynamo_types.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {
    AccountId,
    ContentEditorClientId,
    DocumentCommentThreadId,
    SpaceId,
    WebSocketConnectionId,
} from "~/shared/id/types/id_types.open_source.js";
import {MessagePosOrFilesSchema} from "~/shared/messaging/message_pos_or_files_schema.js";
import {MessageContentPayloadParentSchema} from "~/shared/messaging/message_schema.js";
import {
    MessagingTypingStateSchema,
    createMessageUpdatesBackfillResultSchema,
    createMessagingRealtimeEventSchemas,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {PutMessageApprovalDecisionsPayloadSchema} from "~/shared/messaging/put_message_approval_decisions_payload_schema.js";
import {ReactionOrGenericLikeSchema} from "~/shared/reactions/reaction_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {RynamoSiteEventSchema} from "~/shared/sites/site_realtime_protocol.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";
import {ServerSynchronizationCheckpointSchema} from "~/shared/web_socket/server_synchronization_checkpoint.js";
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

const ApiContentKeySchema = Schema.string.transform<ApiContentKey>({
    serialize: key => key,
    deserialize: key => key as ApiContentKey,
});

const ApiContentPositionSchema = Schema.union({
    Inline: Schema.object({
        type: Schema.value("Inline"),
        key: ApiContentKeySchema,
        index: Schema.integer.min(0),
    }),
    Before: Schema.object({
        type: Schema.value("Before"),
        key: ApiContentKeySchema,
    }),
    After: Schema.object({
        type: Schema.value("After"),
        key: ApiContentKeySchema,
    }),
});

const UpdateContentInputSchema = {
    version: Schema.integer,
    steps: Schema.array(DocumentContentStepSchema),
    clientId: Schema.id<ContentEditorClientId>(),
    createCommentThreads: Schema.array(
        Schema.object({
            commentThreadId: Schema.id<DocumentCommentThreadId>(),
            createdTimeZone: TimeZoneSchema,
            initialCommentContent: MessageContentSchema,
            initialCommentFileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),
        }),
    ),
    intentionallyUpdateAccessPolicy: Schema.object({
        accessPolicy: LocalAccessPolicySchema,
        notification: ShareNotificationSchema.nullable(),
    })
        .nullable()
        .default(null),
    intentionallyUpdateDeletedTime: Schema.object({
        deletedTime: Schema.date,
    })
        .nullable()
        .default(null),
    /**
     * Atomically update our presence state in the same action as we update our
     * content.
     *
     * The state must have a `version` that matches the `version` in this update.
     * However, an important detail is that the state is for the document at `version`
     * plus the `steps` in this update! The selection, for instance, is for the
     * document after steps are applied.
     *
     * The presence state in `UpdateOurPresenceState` is for exactly the referenced
     * document version.
     */
    updateOurPresenceState: Schema.object({
        state: DocumentCollaborationPresenceStateSchema.nullable(),
    }),
} as const;

export type DocumentCollaborationEvent = WebSocketProtocolEventType<
    typeof DocumentCollaborationProtocol
>;

export const DocumentCollaborationProtocol = defineWebSocketProtocol({
    procedures: {
        /**
         * Request a backfill to catch us up from the version our client loaded from the
         * server to the latest, live, document version.
         *
         * Even if the client just loaded a document in the milliseconds between the server
         * returning the document and the client connecting to the collaboration service
         * there may have been an update.
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
            input: UpdateContentInputSchema,
            output: {newVersion: Schema.integer},
        },

        /**
         * Synchronous variant of `updateContent`: persists to DynamoDB _before_
         * broadcasting steps to connected clients.
         *
         * The default optimistic `updateContent` path applies steps to in-memory state and
         * broadcasts them to clients before persistence finishes; on persist failure we
         * throw `DataLossError`, kill the durable object, and force all clients to
         * reconnect (losing any un-persisted steps). This synchronous variant is for
         * callers that can't tolerate that rollback — e.g. server-side flows that move a
         * document into or out of a site, where the response surfaces site events that the
         * caller needs to broadcast atomically with the document write.
         *
         * You shouldn't use this path unless you absolutely need to. See the JSDoc on
         * `DocumentCollaborationContentManager.updateAndWaitForPersistence` for the full
         * set of tradeoffs.
         */
        updateContentWithoutOptimisticBroadcast: {
            input: {
                ...UpdateContentInputSchema,
                // Server-initiated callers (e.g. add/remove an entity from a site) don't know the
                // document version up front and pass `null` to let the durable object rebase
                // against its tracked version.
                version: Schema.integer.nullable(),
                // We don't allow clients to add an document to a site via the `updateContent`
                // procedure, where we require a `LocalAccessPolicy | null` for the access policy.
                // However, clients can use this procedure when adding a document to a site
                intentionallyUpdateAccessPolicy: Schema.object({
                    accessPolicy: CreateOrUpdateAccessPolicySchema,
                    notification: ShareNotificationSchema.nullable(),
                })
                    .nullable()
                    .default(null),
                intentionallyUpdateDeletedTime: Schema.object({
                    deletedTime: Schema.date,
                })
                    .nullable()
                    .default(null),
            },
            output: {
                newVersion: Schema.integer,
                eventsForSite: Schema.array(RynamoSiteEventSchema).default([]),
            },
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
                checkpoint: ServerSynchronizationCheckpointSchema,
                clientCommentCount: Schema.integer,
                newCommentLimit: Schema.integer,
            },
            output: {
                commentThread: DocumentCommentThreadModel.schema(),
                commentCount: Schema.integer,
                newComments: Schema.array(DocumentCommentModel.schema()),
                newOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
                commentUpdatesResult: createMessageUpdatesBackfillResultSchema(
                    DocumentCommentModel.schema(),
                ),
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
                parent: MessageContentPayloadParentSchema.nullable(),
                content: MessageContentSchema,
                fileIds: Schema.array(FileIdOrFileEntityIdSchema),
                createdTimeZone: TimeZoneSchema,
            },
            output: {},
        },

        /** See `updateMessageContent` in `messaging_realtime_protocol.ts`. */
        updateCommentContent: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                commentIndex: Schema.integer,
                contentVersion: Schema.integer,
                steps: Schema.array(MessageContentStepSchema),
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

        /** See `setMessageReaction` in `messaging_realtime_protocol.ts`. */
        setCommentReaction: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                commentIndex: Schema.integer,
                contentVersion: Schema.integer,
                pos: MessagePosOrFilesSchema,
                reaction: ReactionOrGenericLikeSchema,
            },
            output: {},
        },

        /** See `deleteMessageReaction` in `messaging_realtime_protocol.ts`. */
        deleteCommentReaction: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                commentIndex: Schema.integer,
                contentVersion: Schema.integer,
                pos: MessagePosOrFilesSchema,
            },
            output: {},
        },

        /** See `putMessageApprovalDecisions` in `messaging_realtime_protocol.ts`. */
        putCommentApprovalDecisions: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                commentIndex: Schema.integer.min(0),
                payload: PutMessageApprovalDecisionsPayloadSchema,
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
         * This is a part of our collaboration WebSocket protocol because we may have an
         * optimistic comment thread created in the durable object that hasn't been
         * persisted yet.
         */
        getCommentThreadAndInitialCommentsIfExists: {
            input: {
                commentThreadId: Schema.id<DocumentCommentThreadId>(),
                limit: Schema.integer,
            },
            output: {
                checkpoint: ServerSynchronizationCheckpointSchema,
                commentThread: DocumentCommentThreadModel.schema().nullable(),
                initialComments: Schema.array(DocumentCommentModel.schema()),
                initialOtherReferencedComments: Schema.array(DocumentCommentModel.schema()),
            },
        },

        /**
         * Get some comments in a comment thread.
         *
         * This is a part of our collaboration WebSocket protocol because we may have an
         * optimistic comment thread created in the durable object that hasn't been
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
            },
        },

        /**
         * Get some comments in a comment thread.
         *
         * This is a part of our collaboration WebSocket protocol because we may have an
         * optimistic comment thread created in the durable object that hasn't been
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
         * Marks a document comment thread as unresolved. Adds the comment mark back to the
         * document everywhere it was previously. If the comment thread is already
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
         * You have no ordering guarantees around this message! Usually you will get these
         * messages in ascending version order and usually this message will occur before
         * the `PersistedContent` message for the same version. However, usually is the
         * operative word! We can not send this message until we load `ContentReferences`
         * and loading `ContentReferences` does not block other updates. So client
         * implementations need to handle receiving this message out-of-order. A recommend
         * implementation is if you get a future message, put it in a queue until you get
         * earlier messages needed to process it.
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
             * Comment threads that were resolved at the same time as these steps were applied.
             * Remember that when you receive this event we may not have persisted the resolve
             * state yet! You'll get the newly persisted `DocumentCommentThreadModel` object
             * with `PersistedContent`.
             */
            resolveCommentThreadIds: Schema.array(Schema.id<DocumentCommentThreadId>()),

            /**
             * Comment threads that were unresolved at the same time as these steps were
             * applied. Remember that when you receive this event we may not have persisted the
             * resolve state yet! You'll get the newly persisted `DocumentCommentThreadModel`
             * object with `PersistedContent`.
             */
            unresolveCommentThreadIds: Schema.array(Schema.id<DocumentCommentThreadId>()),
        }),

        /**
         * Tells the client that we've successfully persisted all changes at this version
         * and if the client disconnects the changes will still be there.
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
        // `ClosingWithError` message to our WebSocket server protocol. I think we could
        // refactor this to remove this event and call `closeWithError()` instead.
        Error: Schema.object({
            type: Schema.value("Error"),
            error: ErrorSchema,
        }),

        // NOTE(calebmer): Code-style note. We want top-level procedure/event names to use
        // the correct nomenclature for posts. We call "messages" "comments" in a document
        // context. We are ok nesting an event with "message" nomenclature in an event with
        // the name `Comments` but we can't nest procedures hence why we need to write them
        // out from scratch.
        //
        // Was it correct to "comment" as the name in code for document comments? Probably
        // not. All the boilerplate is pretty unnecessary.
        Comments: Schema.object({
            type: Schema.value("Comments"),
            commentThreadId: Schema.id<DocumentCommentThreadId>(),
            event: Schema.union(createMessagingRealtimeEventSchemas(DocumentCommentModel.schema())),
        }),

        SpellCheckRealtimeEvents: Schema.object({
            type: Schema.value("SpellCheckRealtimeEvents"),
            events: Schema.array(createRynamoEventSchema(SpellCheckIgnoredLintModel.schema())),
        }),
    },
});

export const DocumentCollaborationUpdateContentWithDiffRequestBodySchema = Schema.object({
    version: Schema.integer,
    title: Schema.string.optional(),
    content: Schema.array(DocumentContentNodeSchema).optional(),
});

export const DocumentCollaborationUpdateContentWithDiffResponseBodySchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        spaceId: Schema.id<SpaceId>(),
        creatorId: Schema.id<AccountId>().nullable(),
        newVersion: Schema.integer,
        newContent: DocumentContentSchema,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);

export const DocumentCollaborationSetCommentThreadResolvedRequestBodySchema = Schema.object({
    resolved: Schema.boolean,
});

export const DocumentCollaborationSetCommentThreadResolvedResponseBodySchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);

export const DocumentCollaborationCreateCommentThreadForApiRequestBodySchema = Schema.object({
    range: Schema.object({
        start: ApiContentPositionSchema,
        end: ApiContentPositionSchema,
    }),
    content: MessageContentSchema,
    fileIds: Schema.array(FileIdOrFileEntityIdSchema).default([]),
    createdTimeZone: TimeZoneSchema,
});

export const DocumentCollaborationCreateCommentThreadForApiResponseBodySchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        spaceId: Schema.id<SpaceId>(),
        commentThread: Schema.object({
            id: Schema.id<DocumentCommentThreadId>(),
            createdTime: Schema.date,
        }),
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);
