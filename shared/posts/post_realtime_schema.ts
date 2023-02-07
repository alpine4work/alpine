import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {PostCommentModel} from "~/shared/models/post_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type PostRealtimeMessageFromClient = SchemaType<typeof PostRealtimeMessageFromClientSchema>;

export const PostRealtimeMessageFromClientSchema = Schema.union({
    BackfillPostCommentsRequest: Schema.object({
        type: Schema.value("BackfillPostCommentsRequest"),
        currentCommentCount: Schema.integer,
        backfillCommentLimit: Schema.integer,
    }),
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
    BackfillPostCommentsResponse: Schema.object({
        type: Schema.value("BackfillPostCommentsResponse"),
        commentCount: Schema.integer,
        newComments: Schema.array(PostCommentModel.schema()),
    }),
    NewPostComment: Schema.object({
        type: Schema.value("NewPostComment"),
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
