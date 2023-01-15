import {PostContentSchema} from "~/shared/posts/post_content_schema";
import {Model} from "~/shared/schema/model";
import {Schema} from "~/shared/schema/schema";

export class PostModel extends Model(
    Schema.object({
        id: Schema.id,
        spaceId: Schema.id,
        channelId: Schema.id,
        createdTime: Schema.date,
        authorAccountId: Schema.id,
        content: PostContentSchema,
    }),
) {}
