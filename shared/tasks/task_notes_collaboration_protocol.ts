import {ContentReferencesSchema} from "~/shared/content/content_references.js";
import {
    MessageContentSchema,
    MessageContentStepSchema,
} from "~/shared/content/message_content_schema.js";
import {createRynamoEventSchema} from "~/shared/dynamo/rynamo_types.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {
    ContentEditorClientId,
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
import {Schema} from "~/shared/schema/schema.js";
import {TaskCommentModel} from "~/shared/tasks/model/task_comment_model.js";
import {TaskActivityModelSchema} from "~/shared/tasks/task_activity.js";
import {
    TaskNotesContentNodeSchema,
    TaskNotesContentSchema,
    TaskNotesContentStepSchema,
} from "~/shared/tasks/task_notes_content_schema.js";
import {ServerSynchronizationCheckpointSchema} from "~/shared/web_socket/server_synchronization_checkpoint.js";
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
         * Request a backfill to catch us up from the version our client loaded from the
         * server to the latest, live, task notes version.
         *
         * Even if the client just loaded notes in the milliseconds between the server
         * returning the notes and the client connecting to the collaboration service there
         * may have been an update.
         *
         * If the client requests a backfill from a version in the future (which can happen
         * if a previous durable object confirmed steps to the client but crashed before
         * persisting them) the server throws a
         * `taskNotesBackfillFutureVersionErrorMessage` error. The client then reverts its
         * confirmed-but-unpersisted steps back to its persisted version and retries the
         * backfill.
         */
        backfillNotes: {
            input: {
                version: Schema.integer,
            },
            output: {
                newVersion: Schema.integer,
                persistedVersion: Schema.integer,
                steps: Schema.array(
                    Schema.object({
                        step: TaskNotesContentStepSchema,
                        clientId: Schema.id<ContentEditorClientId>(),
                    }),
                ),
                stepsContentReferences: ContentReferencesSchema,
            },
        },

        updateNotesContent: {
            input: {
                version: Schema.integer,
                steps: Schema.array(TaskNotesContentStepSchema),
                clientId: Schema.id<ContentEditorClientId>(),
            },
            output: {},
        },

        backfillComments: {
            input: {
                checkpoint: ServerSynchronizationCheckpointSchema,
                clientCommentCount: Schema.integer,
                newCommentLimit: Schema.integer,
            },
            output: {
                commentCount: Schema.integer,
                newComments: Schema.array(TaskCommentModel.schema()),
                newOtherReferencedComments: Schema.array(TaskCommentModel.schema()),
                commentUpdatesResult: createMessageUpdatesBackfillResultSchema(
                    TaskCommentModel.schema(),
                ),
                typingStateByConnectionId: Schema.map(
                    Schema.id<WebSocketConnectionId>(),
                    MessagingTypingStateSchema,
                ),
            },
        },

        createComment: {
            input: {
                parent: MessageContentPayloadParentSchema.nullable(),
                content: MessageContentSchema,
                fileIds: Schema.array(FileIdOrFileEntityIdSchema),
                createdTimeZone: TimeZoneSchema,
            },
            output: {},
        },

        updateCommentContent: {
            input: {
                commentIndex: Schema.integer,
                contentVersion: Schema.integer,
                steps: Schema.array(MessageContentStepSchema),
            },
            output: {},
        },

        deleteComment: {
            input: {
                commentIndex: Schema.integer,
            },
            output: {},
        },

        setCommentReaction: {
            input: {
                commentIndex: Schema.integer,
                contentVersion: Schema.integer,
                pos: MessagePosOrFilesSchema,
                reaction: ReactionOrGenericLikeSchema,
            },
            output: {},
        },

        deleteCommentReaction: {
            input: {
                commentIndex: Schema.integer,
                contentVersion: Schema.integer,
                pos: MessagePosOrFilesSchema,
            },
            output: {},
        },

        /**
         * Record the current account's decisions on a comment stream's approval requests.
         * The updated approvals part is sent to every connected client as a
         * `PutMessageStreamPart` event before this procedure resolves for the caller.
         */
        putCommentApprovalDecisions: {
            input: {
                commentIndex: Schema.integer.min(0),
                payload: PutMessageApprovalDecisionsPayloadSchema,
            },
            output: {},
        },

        startTypingInCommentInput: {
            input: {},
            output: {},
        },

        stopTypingInCommentInput: {
            input: {},
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
         * You have no ordering guarantees around this message! Usually you will get these
         * messages in ascending version order and usually this message will occur before
         * the `PersistedContent` message for the same version. However, usually is the
         * operative word! We can not send this message until we load `ContentReferences`
         * and loading `ContentReferences` does not block other updates. So client
         * implementations need to handle receiving this message out-of-order. A recommend
         * implementation is if you get a future message, put it in a queue until you get
         * earlier messages needed to process it.
         */
        UpdateNotesContentWithoutPersistence: Schema.object({
            type: Schema.value("UpdateNotesContentWithoutPersistence"),
            newVersion: Schema.integer,
            steps: Schema.array(TaskNotesContentStepSchema),
            stepsContentReferences: ContentReferencesSchema,
            clientId: Schema.id<ContentEditorClientId>(),
        }),

        Comments: Schema.object({
            type: Schema.value("Comments"),
            event: Schema.union(createMessagingRealtimeEventSchemas(TaskCommentModel.schema())),
        }),

        /**
         * Tells the client that we've successfully persisted all changes at this version
         * and if the client disconnects the changes will still be there.
         *
         * You may get a `PersistedContent` event before a
         * `UpdateNotesContentWithoutPersistence` with the steps for this version. That's
         * because we need to load references from the database before we can send
         * `UpdateNotesContentWithoutPersistence` and persistence may happen before that.
         */
        PersistedContent: Schema.object({
            type: Schema.value("PersistedContent"),
            newVersion: Schema.integer,
        }),

        /**
         * Task activity (see `TaskActivityTable`) for this task. Carries every activity
         * event one projection transaction produced, so a transaction costs one event
         * rather than one per item.
         *
         * Unlike the other events here this one originates outside the durable object: the
         * writer broadcasts it in through `/broadcast-task-activity` once the projection
         * transaction commits.
         *
         * There is no opt-in. Being connected to this durable object IS the subscription,
         * which is exactly what the task detail view wants — it connects to collaborate on
         * notes and comments, and activity is the third thing rendered in that same
         * timeline.
         */
        TaskActivity: Schema.object({
            type: Schema.value("TaskActivity"),
            events: Schema.array(createRynamoEventSchema(TaskActivityModelSchema)),
        }),
    },
});

/**
 * Body of the `/broadcast-task-activity` durable object route. Mirrors the
 * `TaskActivity` event, minus the discriminant the event union adds.
 */
export const TaskNotesCollaborationBroadcastTaskActivityRequestBodySchema = Schema.object({
    events: Schema.array(createRynamoEventSchema(TaskActivityModelSchema)),
});

export const TaskNotesCollaborationUpdateContentWithDiffRequestBodySchema = Schema.object({
    version: Schema.integer,
    content: Schema.array(TaskNotesContentNodeSchema),
});

export const TaskNotesCollaborationUpdateContentWithDiffResponseBodySchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        spaceId: Schema.id<SpaceId>(),
        newVersion: Schema.integer,
        newContent: TaskNotesContentSchema,
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);
