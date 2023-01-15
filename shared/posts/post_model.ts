import {AccountId, ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {PostContentSchema} from "~/shared/posts/post_content_schema";
import {Model} from "~/shared/schema/model";
import {Schema} from "~/shared/schema/schema";

export class PostModel extends Model(
    Schema.object({
        id: Schema.id<PostId>(),
        spaceId: Schema.id<SpaceId>(),
        channelId: Schema.id<ChannelId>(),
        createdTime: Schema.date,
        authorId: Schema.id<AccountId>(),
        content: PostContentSchema,
    }),
) {}
