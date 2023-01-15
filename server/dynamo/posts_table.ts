import {getChannel} from "~/server/dynamo/channels_table";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {NotFoundError} from "~/shared/error/error";
import {Id, generateId} from "~/shared/id/id";
import {PostContent, PostContentSchema} from "~/shared/posts/post_content_schema";
import {PostModel} from "~/shared/posts/post_model";
import {Schema} from "~/shared/schema/schema";

const PostsTable = DynamoTableSchema.new({
    name: "Posts",
    partitions: {
        Post: {
            partitionKeyAttributes: {
                postId: DynamoKeyAttributeSchema.id,
            },
            sortRanges: {
                Attributes: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id,

                        /**
                         * What channel was this posted in?
                         *
                         * Must have the same `spaceId` as this post. We include the `spaceId` in this
                         * item in case we ever have posts that are not a part of a channel. Posts that
                         * aren't a part of a channel should still be part of a space.
                         */
                        channelId: Schema.id,

                        /** When was this post created? */
                        createdTime: Schema.date,

                        /** Which account created this post? */
                        authorAccountId: Schema.id,

                        /** The contents of this post. */
                        content: PostContentSchema,
                    }),
                },
            },
        },
    },
});

type PostAttributesItem = DynamoTableItemType<typeof PostsTable, "Post", "Attributes">;

/**
 * Create a new post by the current account in the provided channel.
 */
export async function createPost(
    context: RequestContext,
    {channelId, content}: {channelId: Id; content: PostContent},
) {
    const channel = await getChannel(context, channelId);
    if (!channel) throw new NotFoundError("Channel does not exist");

    const postItem: PostAttributesItem = {
        partitionType: "Post",
        sortRangeType: "Attributes",
        postId: generateId(),
        spaceId: channel.spaceId,
        channelId: channel.id,
        createdTime: new Date(),
        authorAccountId: context.auth.getAccountId(),
        content,
    };

    await PostsTable.createItem(context, postItem);
    return createPostModelFromItem(postItem);
}

/**
 * Gets the post with the provided ID.
 */
export async function getPost(context: RequestContext, id: Id): Promise<PostModel | null> {
    const postItem = await PostsTable.getItem(context, {
        partitionType: "Post",
        sortRangeType: "Attributes",
        postId: id,
    });
    if (!postItem) return null;

    // Make sure we have access to the channel and the space the channel is in.
    const channel = await getChannel(context, postItem.channelId);
    if (!channel) throw new NotFoundError("Channel does not exist");

    return createPostModelFromItem(postItem);
}

function createPostModelFromItem(postItem: PostAttributesItem): PostModel {
    return new PostModel({
        id: postItem.postId,
        spaceId: postItem.spaceId,
        channelId: postItem.channelId,
        createdTime: postItem.createdTime,
        authorAccountId: postItem.authorAccountId,
        content: postItem.content,
    });
}
