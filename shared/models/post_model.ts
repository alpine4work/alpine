import {MessageContentSchema} from "~/shared/content/message_content_schema";
import {PostContentSchema} from "~/shared/content/post_content_schema";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {MessageInterface} from "~/shared/models/message_interface";
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
            id: Schema.integer,
            author: AccountModel.schema(),
            createdTime: Schema.date,
            parentCommentId: Schema.integer.nullable(),
            content: MessageContentSchema,
            contentUpdatedTime: Schema.date.nullable(),
        }),
    )
    implements MessageInterface
{
    // An alias for `parentCommentId` to comply with `MessageInterface`.
    public get parentMessageId() {
        return this.parentCommentId;
    }
}
