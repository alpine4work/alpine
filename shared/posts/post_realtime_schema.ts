import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {MessageContentWithReferencesSchema} from "~/shared/models/message_interface";
import {PostCommentModel} from "~/shared/models/post_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type PostRealtimeMessageFromClient = SchemaType<typeof PostRealtimeMessageFromClientSchema>;

export const PostRealtimeMessageFromClientSchema = Schema.union({
    /**
     * When you connect to the post realtime WebSocket you should send a
     * `BackfillPostCommentsRequest`. You will not get `NewPostComment` realtime
     * messages until you do.
     *
     * This makes sure the client and server are in sync about what the client's
     * state is. If the WebSocket server has received new messages since the client
     * loaded its data from the HTTP server then we will send a backfill response
     * with those new messages.
     */
    BackfillPostCommentsRequest: Schema.object({
        type: Schema.value("BackfillPostCommentsRequest"),
        currentCommentCount: Schema.integer,
        backfillCommentLimit: Schema.integer,
    }),
    /**
     * Create a new post comment and send a realtime message to all other connected
     * clients.
     */
    CreatePostComment: Schema.object({
        type: Schema.value("CreatePostComment"),
        parentCommentIndex: Schema.integer.nullable(),
        content: MessageContentSchema,
    }),
    /**
     * Update the contents of a post comment and send a realtime message to all
     * other connected clients.
     */
    UpdatePostCommentContent: Schema.object({
        type: Schema.value("UpdatePostCommentContent"),
        commentIndex: Schema.integer,
        content: MessageContentSchema,
    }),
    /**
     * Delete a post comment and send a realtime message to all other connected
     * clients.
     */
    DeletePostComment: Schema.object({
        type: Schema.value("DeletePostComment"),
        commentIndex: Schema.integer,
    }),
});

export type PostRealtimeMessageFromServer = SchemaType<typeof PostRealtimeMessageFromServerSchema>;

export const PostRealtimeMessageFromServerSchema = Schema.union({
    /**
     * Response to a `BackfillPostCommentsRequest` message. Contains the actual
     * comment count and an array of new comments we should load into our messages.
     *
     * Ordering guarantee: You will get no `NewPostComment` messages until your
     * first `BackfillPostCommentsResponse` message.
     */
    BackfillPostCommentsResponse: Schema.object({
        type: Schema.value("BackfillPostCommentsResponse"),
        commentCount: Schema.integer,
        comments: Schema.array(PostCommentModel.schema()),
        otherReferencedComments: Schema.array(PostCommentModel.schema()),
    }),
    /**
     * A new comment was created! The comment could have been created by our
     * account or a different account. Or our account on a different browser.
     *
     * Ordering guarantee: You will get no `NewPostComment` messages until you have
     * sent `BackfillPostCommentsRequest` and received a
     * `BackfillPostCommentsResponse`. After that you are guaranteed to get every
     * comment in order. You will not get comment N+1 before comment N, you'll
     * always get comment N first and then comment N+1.
     */
    NewPostComment: Schema.object({
        type: Schema.value("NewPostComment"),
        comment: PostCommentModel.schema(),
    }),
    /**
     * A comment was updated.
     *
     * Ordering guarantee: There are no ordering guarantees. You may receive an
     * update message at any time in any order. You should make sure to only show
     * the update with the greatest `contentUpdatedTime`. `contentUpdatedTime` will
     * increase after every update.
     */
    UpdatedPostCommentContent: Schema.object({
        type: Schema.value("UpdatedPostCommentContent"),
        commentIndex: Schema.integer,
        content: MessageContentWithReferencesSchema,
        contentUpdatedTime: Schema.date,
    }),
    /**
     * A comment was deleted.
     *
     * Ordering guarantee: There are no ordering guarantees. You may receive a
     * delete message at any time in any order. Use `deletedTime` and compare it to
     * `contentUpdatedTime`. The latest update between deletes and updates can be
     * determined through the timestamp. You can not restore a comment that was
     * deleted with an update, though.
     */
    DeletedPostComment: Schema.object({
        type: Schema.value("DeletedPostComment"),
        commentIndex: Schema.integer,
        deletedTime: Schema.date,
    }),
});
