import {AccountModel} from "~/shared/accounts/account_model";
import {ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types";
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
    }),
) {}
