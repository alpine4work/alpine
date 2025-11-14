import {
    DynamoGeneralRealtimeEventStubSchema,
    createDynamoGeneralRealtimeEventSchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {FileIdOrFileEntityIdSchema} from "~/shared/files/file_entity_id.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {WebSocketConnectionId} from "~/shared/id/types/id_types.js";
import {
    MessageContentSchema,
    MessageContentStepSchema,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayloadParentSchema} from "~/shared/messaging/message_schema.js";
import {
    MessagingTypingStateSchema,
    createMessageUpdatesBackfillResultSchema,
    createMessagingRealtimeEventSchemas,
} from "~/shared/messaging/messaging_realtime_protocol.js";
import {ReactionOrGenericLikeSchema} from "~/shared/reactions/reaction_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {ServerSynchronizationCheckpointSchema} from "~/shared/web_socket/server_synchronization_checkpoint.js";
import {
    WebSocketProtocolEventType,
    defineWebSocketProtocol,
} from "~/shared/web_socket/web_socket_protocol.js";

export type DynamoGeneralRealtimePostEvent = SchemaType<
    typeof DynamoGeneralRealtimePostEventSchema
>;

export const DynamoGeneralRealtimePostEventSchema = createDynamoGeneralRealtimeEventSchema(
    PostModel.schema(),
);

export type PostRealtimeEvent = WebSocketProtocolEventType<typeof PostRealtimeProtocol>;

export const PostRealtimeProtocol = defineWebSocketProtocol({
    procedures: {
        /** See `backfillMessages` in `messaging_realtime_protocol.ts`. */
        backfillComments: {
            input: {
                checkpoint: ServerSynchronizationCheckpointSchema,
                clientCommentCount: Schema.integer,
                newCommentLimit: Schema.integer,
            },
            output: {
                commentCount: Schema.integer,
                newComments: Schema.array(PostCommentModel.schema()),
                newOtherReferencedComments: Schema.array(PostCommentModel.schema()),
                commentUpdatesResult: createMessageUpdatesBackfillResultSchema(
                    PostCommentModel.schema(),
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
                commentIndex: Schema.integer,
                contentVersion: Schema.integer,
                steps: Schema.array(MessageContentStepSchema),
            },
            output: {},
        },

        /** See `deleteMessage` in `messaging_realtime_protocol.ts`. */
        deleteComment: {
            input: {
                commentIndex: Schema.integer,
            },
            output: {},
        },

        /** See `setMessageReaction` in `messaging_realtime_protocol.ts`. */
        setCommentReaction: {
            input: {
                commentIndex: Schema.integer,
                contentVersion: Schema.integer,
                pos: Schema.integer,
                reaction: ReactionOrGenericLikeSchema,
            },
            output: {},
        },

        /** See `deleteMessageReaction` in `messaging_realtime_protocol.ts`. */
        deleteCommentReaction: {
            input: {
                commentIndex: Schema.integer,
                contentVersion: Schema.integer,
                pos: Schema.integer,
            },
            output: {},
        },

        /** See `startTypingInCommentInput` in `messaging_realtime_protocol.ts`. */
        startTypingInCommentInput: {
            input: {},
            output: {},
        },

        /** See `stopTypingInCommentInput` in `messaging_realtime_protocol.ts`. */
        stopTypingInCommentInput: {
            input: {},
            output: {},
        },
    },
    events: {
        // NOTE(calebmer): Code-style note. We want top-level procedure/event names to
        // use the correct nomenclature for posts. We call "messages" "comments" in a
        // post context. We are ok nesting an event with "message" nomenclature in an
        // event with the name `Comments` but we can't nest procedures hence why we
        // need to write them out from scratch.
        //
        // Was it correct to "comment" as the name in code for post comments? Probably
        // not. All the boilerplate is pretty unnecessary.
        Comments: Schema.object({
            type: Schema.value("Comments"),
            event: Schema.union(createMessagingRealtimeEventSchemas(PostCommentModel.schema())),
        }),

        RealtimeEventTransaction: Schema.object({
            type: Schema.value("RealtimeEventTransaction"),
            eventTransaction: Schema.array(DynamoGeneralRealtimePostEventSchema),
        }),
    },
});

export const PostBroadcastRealtimeEventTransactionSchema = Schema.object({
    eventTransaction: Schema.array(DynamoGeneralRealtimeEventStubSchema),
});
