import {
    MessagingRealtimeMessageFromClientSchema,
    createMessagingRealtimeMessageFromServerSchema,
} from "~/shared/messaging/messaging_realtime_schema";
import {PostCommentModel} from "~/shared/models/post_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type PostRealtimeMessageFromClient = SchemaType<typeof PostRealtimeMessageFromClientSchema>;

export const PostRealtimeMessageFromClientSchema = Schema.union({
    /**
     * Some realtime message regarding this post's comments.
     */
    PostComments: Schema.object({
        type: Schema.value("PostComments"),
        message: MessagingRealtimeMessageFromClientSchema,
    }),
});

export type PostRealtimeMessageFromServer = SchemaType<typeof PostRealtimeMessageFromServerSchema>;

export const PostRealtimeMessageFromServerSchema = Schema.union({
    /**
     * Some realtime message regarding this post's comments.
     */
    PostComments: Schema.object({
        type: Schema.value("PostComments"),
        message: createMessagingRealtimeMessageFromServerSchema(PostCommentModel.schema()),
    }),
});
