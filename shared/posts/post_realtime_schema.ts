import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {PostCommentModel} from "~/shared/models/post_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type PostRealtimeMessageFromClient = SchemaType<typeof PostRealtimeMessageFromClientSchema>;

export const PostRealtimeMessageFromClientSchema = Schema.union({
    CreatePostComment: Schema.object({
        type: Schema.value("CreatePostComment"),
        parentCommentIndex: Schema.integer.nullable(),
        content: MessageContentSchema,
    }),
    UpdatePostCommentContent: Schema.object({
        type: Schema.value("UpdatePostCommentContent"),
        commentIndex: Schema.integer,
        content: MessageContentSchema,
    }),
    DeletePostComment: Schema.object({
        type: Schema.value("DeletePostComment"),
        commentIndex: Schema.integer,
    }),
});

export type PostRealtimeMessageFromServer = SchemaType<typeof PostRealtimeMessageFromServerSchema>;

export const PostRealtimeMessageFromServerSchema = Schema.union({
    CreatedPostComment: Schema.object({
        type: Schema.value("CreatedPostComment"),
        comment: PostCommentModel.schema(),
    }),
    UpdatedPostCommentContent: Schema.object({
        type: Schema.value("UpdatedPostCommentContent"),
        commentIndex: Schema.integer,
        content: MessageContentSchema,
        contentUpdatedTime: Schema.date,
    }),
    DeletedPostComment: Schema.object({
        type: Schema.value("DeletedPostComment"),
        commentIndex: Schema.integer,
        deletedTime: Schema.date,
    }),
});
