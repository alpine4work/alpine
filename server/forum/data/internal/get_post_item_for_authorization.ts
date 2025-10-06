import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    ForumRealtimeTable,
    PostAttributesItem,
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {createPostNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {emptyObject} from "~/shared/helpers/object/empty_object.js";
import {PostId} from "~/shared/id/types/id_types.js";

export const PostItemAuthorizationCache = new DynamoContextCache<
    PostId,
    Pick<
        PostAttributesItem,
        "partitionType" | "sortRangeType" | "postId" | "spaceId" | "channelId" | "authorId"
    > | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend
    // on who the actor is.
    whenActorChanges: "DangerouslyShare",
});

export async function getPostItemForAuthorizationIfExists(
    context: ServerMinimalActionContext,
    postId: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<Pick<
    PostAttributesItem,
    "partitionType" | "sortRangeType" | "postId" | "spaceId" | "channelId" | "authorId"
> | null> {
    return PostItemAuthorizationCache.get(context, consistency, postId, consistency =>
        ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            },
            {
                consistency,
                attributes: ["spaceId", "channelId", "authorId"],
            },
        ),
    );
}

export async function getPostItemForAuthorization(
    context: ServerMinimalActionContext,
    postId: PostId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<
    Pick<
        PostAttributesItem,
        "partitionType" | "sortRangeType" | "postId" | "spaceId" | "channelId" | "authorId"
    >
> {
    const item = await getPostItemForAuthorizationIfExists(context, postId, options);
    if (!item) throw createPostNotFoundError(postId);
    return item;
}
