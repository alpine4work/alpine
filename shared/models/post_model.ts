import {PostContentSchema} from "~/shared/content/post_content_schema";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {MessageInterface, MessagePayloadSchema} from "~/shared/models/message_interface";
import {Model} from "~/shared/models/model";
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
         * The total number of comments on the post.
         */
        commentCount: Schema.integer,
        /**
         * The number of accounts who authored a comment on this post.
         */
        commentAuthorCount: Schema.integer,
        /**
         * Some of the authors who commented on this post. Only the first 5 or so. If
         * the length of this array is shorter than `commentAuthorCount` then you know
         * there are more authors we aren't including.
         */
        previewCommentAuthors: Schema.array(AccountModel.schema()),
    }),
) {}

/**
 * A comment on a post.
 *
 * The `postId` for the comment should be known based on context.
 */
export class PostCommentModel
    extends Model(
        Schema.object({
            postId: Schema.id<PostId>(),
            index: Schema.integer,
            author: AccountModel.schema(),
            createdTime: Schema.date,
            payload: MessagePayloadSchema,
        }),
    )
    implements MessageInterface<PostId>
{
    public getRoomKey() {
        return this.postId;
    }
}
