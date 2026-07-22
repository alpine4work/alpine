import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
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
        | "partitionType"
        | "sortRangeType"
        | "postId"
        | "spaceId"
        | "channelId"
        | "author"
        | "createdTime"
        | "contentUpdate"
        | "commentsSummary"
        | "updateLockVersion"
    > | null
>({
    // Allow sharing this cache because the loaded DynamoDB item doesn't depend on who
    // the actor is.
    whenActorChanges: "DangerouslyShare",
});

export type PostItemForAuthorization = Pick<
    PostAttributesItem,
    | "partitionType"
    | "sortRangeType"
    | "postId"
    | "spaceId"
    | "channelId"
    | "author"
    | "createdTime"
    | "contentUpdate"
    | "commentsSummary"
    | "updateLockVersion"
>;

export async function getPostItemForAuthorizationIfExists(
    context: ServerMinimalActionContext,
    postId: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = emptyObject,
): Promise<PostItemForAuthorization | null> {
    return await PostItemAuthorizationCache.get(context, consistency, postId, consistency =>
        ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            },
            {
                consistency,
                attributes: [
                    "spaceId",
                    "channelId",
                    "author",
                    "createdTime",
                    "contentUpdate",
                    "commentsSummary",
                    "updateLockVersion",
                ],
            },
        ),
    );
}

export async function getPostItemForAuthorization(
    context: ServerMinimalActionContext,
    postId: PostId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<PostItemForAuthorization> {
    const item = await getPostItemForAuthorizationIfExists(context, postId, options);
    if (!item) throw createPostNotFoundError(postId);
    return item;
}

export function getPostItemWithContentForAuthorizationIfExists(
    context: ServerMinimalActionContext,
    postId: PostId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<DynamoItem<PostAttributesItem> | null> {
    const itemPromise = ForumRealtimeTable.getItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {consistency},
    );

    // After we've loaded a post, save it to the authorization cache so if we need to
    // authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, consistency, postId, itemPromise);

    return itemPromise;
}

export async function getPostItemWithContentForAuthorization(
    context: ServerMinimalActionContext,
    postId: PostId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<DynamoItem<PostAttributesItem>> {
    const item = await getPostItemWithContentForAuthorizationIfExists(context, postId, options);
    if (!item) throw createPostNotFoundError(postId);
    return item;
}
