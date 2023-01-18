import {AccountModel} from "~/shared/accounts/account_model";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {
    PostCommentContent,
    PostCommentContentSchema,
} from "~/shared/posts/post_comment_content_schema";
import {PostContentSchema} from "~/shared/posts/post_content_schema";
import {Model} from "~/shared/schema/model";
import {Schema} from "~/shared/schema/schema";

/**
 * A post creates a thread of conversation in a channel. Users can write any
 * content they want in a post and it will be delivered to all members of a
 * channel through their inbox and feed.
 *
 * Other users can comment on the post and have a conversation. Post comments
 * include one level of threading.
 */
export class PostModel extends Model(
    Schema.object({
        id: Schema.id<PostId>(),
        spaceId: Schema.id<SpaceId>(),
        channelId: Schema.id<ChannelId>(),
        createdTime: Schema.date,
        author: AccountModel.schema(),
        content: PostContentSchema,
        /**
         * The total number of comments on this post. Both root comments and
         * reply comments.
         */
        totalCommentCount: Schema.integer,
        /**
         * The total number of accounts who commented on this post.
         *
         * Includes authors of both root comments and reply comments.
         */
        totalCommentAuthorCount: Schema.integer,
        /**
         * The first few authors to have left a comment on this post so we can
         * render a preview of who's commented. Ordered by who commented on the
         * post first.
         *
         * The length of this array should be less than or equal to
         * `totalCommentAuthorCount`. You know if there are more authors if
         * `totalCommentAuthorCount` is higher than the length of this array.
         *
         * Includes authors of both root comments and reply comments.
         */
        previewCommentAuthors: Schema.array(AccountModel.schema()),
    }),
) {}

/**
 * There are two kinds of post comments. Root comments and reply comments.
 *
 * - Root comments are displayed at the top-level of a post. Root comments may
 *   have some reply comments.
 * - Reply comments always come after a root comment. When you view a post we
 *   show you a preview of reply comments and make you expand to show more if
 *   you'd like to see all of them.
 */
interface PostCommentModel {
    readonly postId: PostId;
    readonly createdTime: Date;
    readonly author: AccountModel;
    readonly content: PostCommentContent | null;
}

/**
 * A reply to a root post comment.
 */
export class PostReplyCommentModel
    extends Model(
        Schema.object({
            postId: Schema.id<PostId>(),
            /**
             * The number of the root comment we are replying to.
             */
            rootCommentNumber: Schema.integer,
            /**
             * The number identifier for this reply comment. Unique within the root
             * comment replies.
             */
            replyCommentNumber: Schema.integer,
            createdTime: Schema.date,
            author: AccountModel.schema(),
            content: PostCommentContentSchema,
        }),
    )
    implements PostCommentModel {}

/**
 * A root comment at the top-level of a post. Includes the reply comment count
 * and some reply comments to preview.
 */
export class PostRootCommentModel
    extends Model(
        Schema.object({
            postId: Schema.id<PostId>(),
            /**
             * The identifier number for this comment. Unique within the post's comments.
             */
            rootCommentNumber: Schema.integer,
            createdTime: Schema.date,
            author: AccountModel.schema(),
            /**
             * The contents of this comment.
             *
             * If content is `null` that means the comment was deleted but there are still
             * some replies. We can't fully delete a root comment until its replies have
             * also been deleted. We will show a "this comment is deleted" message with the
             * replies underneath for a deleted root comment with replies.
             */
            content: PostCommentContentSchema.nullable(),
            /**
             * The total number of reply comments on this root comment.
             */
            totalReplyCommentCount: Schema.integer,
            /**
             * A small number of reply comments on this root comment that we preview when
             * viewing the root comment.
             *
             * You can tell if the root comment has more replies if
             * `totalReplyCommentCount` is longer than the length of this array.
             */
            previewReplyComments: Schema.array(PostReplyCommentModel.schema()),
            /**
             * The total number of accounts who replied to this root comment.
             */
            totalReplyCommentAuthorCount: Schema.integer,
            /**
             * The first few authors to have replied to this root comment so we can
             * render a preview of who's commented. Ordered by who replied to the
             * root comment first.
             *
             * The length of this array should be less than or equal to
             * `totalReplyCommentAuthorCount`. You know if there are more authors if
             * `totalReplyCommentAuthorCount` is higher than the length of this array.
             */
            previewReplyCommentAuthors: Schema.array(AccountModel.schema()),
        }),
    )
    implements PostCommentModel {}
