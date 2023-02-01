import {getAccountOrThrow} from "~/server/dynamo/accounts_table";
import {authorizeChannelAccess, getChannel} from "~/server/dynamo/channels_table";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry_dynamo_condition_check_errors";
import {MessageContent, MessageContentSchema} from "~/shared/content/message_content_schema";
import {PostContent, PostContentSchema} from "~/shared/content/post_content_schema";
import {
    DataLossError,
    InternalError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable";
import {generateId} from "~/shared/id/id";
import {AccountId, ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {PostCommentModel, PostModel} from "~/shared/models/post_model";
import {Schema} from "~/shared/schema/schema";

const PostsTable = DynamoTableSchema.new({
    name: "Posts",
    partitions: {
        Post: {
            partitionKeyAttributes: {
                postId: DynamoKeyAttributeSchema.id<PostId>(),
            },
            sortRanges: {
                Attributes: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),

                        /**
                         * What channel was this posted in?
                         *
                         * Must have the same `spaceId` as this post. We include the `spaceId` in this
                         * item in case we ever have posts that are not a part of a channel. Posts that
                         * aren't a part of a channel should still be part of a space.
                         */
                        channelId: Schema.id<ChannelId>(),

                        /** When was this post created? */
                        createdTime: Schema.date,

                        /** Which account created this post? */
                        authorId: Schema.id<AccountId>(),

                        /** The contents of this post. */
                        content: PostContentSchema,

                        /**
                         * Information regarding the post's comments. Nested in an object so we can
                         * update it at once.
                         */
                        commentsSummary: Schema.object({
                            /**
                             * The ID of the next comment.
                             */
                            nextCommentId: Schema.integer.min(1),

                            /**
                             * All the accounts which have commented on the post and the number of comments
                             * they have made. The map is ordered by when the account first commented on
                             * the post.
                             *
                             * This map can grow unbounded but we do need the total number of accounts to
                             * comment.
                             */
                            commentCountByAuthorId: Schema.map(
                                Schema.id<AccountId>(),
                                Schema.integer.min(1),
                            ),
                        }).default({
                            nextCommentId: 1,
                            commentCountByAuthorId: new Map(),
                        }),
                    }),
                },
                /**
                 * Comments on a post. Has all the attributes needed for a message in
                 * `MessageInterface`.
                 */
                Comments: {
                    sortKeyAttributes: {
                        commentId: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        authorId: Schema.id<AccountId>(),
                        createdTime: Schema.date,
                        parentCommentId: Schema.integer.nullable(),
                        content: MessageContentSchema,
                        contentUpdatedTime: Schema.date.nullable(),
                    }),
                },
            },
        },
    },
});

type PostAttributesItem = DynamoTableItemType<typeof PostsTable, "Post", "Attributes">;
type PostCommentItem = DynamoTableItemType<typeof PostsTable, "Post", "Comments">;

/**
 * Create a new post by the current account in the provided channel.
 */
export async function createPost(
    context: RequestContext,
    {channelId, content}: {channelId: ChannelId; content: PostContent},
): Promise<{
    id: PostId;
    spaceId: SpaceId;
    createdTime: Date;
}> {
    const channel = await getChannel(context, channelId);
    if (!channel) throw new NotFoundError("Channel does not exist");

    const postItem: PostAttributesItem = {
        partitionType: "Post",
        sortRangeType: "Attributes",
        postId: generateId(),
        spaceId: channel.spaceId,
        channelId: channel.id,
        createdTime: new Date(),
        authorId: context.auth.getAccountId(),
        content,
        commentsSummary: {
            nextCommentId: 1,
            commentCountByAuthorId: new Map(),
        },
    };

    await PostsTable.createItem(context, postItem);

    return {
        id: postItem.postId,
        spaceId: channel.spaceId,
        createdTime: postItem.createdTime,
    };
}

/**
 * Gets the post with the provided ID.
 */
export async function getPost(context: RequestContext, id: PostId): Promise<PostModel | null> {
    const postItem = await PostsTable.getItem(context, {
        partitionType: "Post",
        sortRangeType: "Attributes",
        postId: id,
    });
    if (!postItem) return null;

    await authorizeChannelAccess(context, postItem.channelId);

    return createPostModelFromItem(context, postItem);
}

async function createPostModelFromItem(
    context: RequestContext,
    item: PostAttributesItem,
): Promise<PostModel> {
    const [author, previewCommentAuthors] = await runAllPromises([
        getAccountOrThrow(context, item.spaceId, item.authorId),
        runAllPromises(
            Array.from(
                sliceIterable(item.commentsSummary.commentCountByAuthorId.keys(), 0, 5),
                accountId => getAccountOrThrow(context, item.spaceId, accountId),
            ),
        ),
    ]);

    return new PostModel({
        id: item.postId,
        spaceId: item.spaceId,
        channelId: item.channelId,
        createdTime: item.createdTime,
        author,
        content: item.content,
        commentCount: reduceIterable(
            item.commentsSummary.commentCountByAuthorId.values(),
            (commentCount, authorCommentCount) => commentCount + authorCommentCount,
            0,
        ),
        commentAuthorCount: item.commentsSummary.commentCountByAuthorId.size,
        previewCommentAuthors,
    });
}

/**
 * Get all the authors on a post to a certain limit.
 */
export async function getPostCommentAuthors(
    context: RequestContext,
    {postId, limit}: {postId: PostId; limit: number},
): Promise<Array<AccountModel>> {
    const postItem = await PostsTable.getPartialItem(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            attributes: ["spaceId", "channelId", "commentsSummary"],
        },
    );
    if (!postItem) throw new NotFoundError("Post not found");

    await authorizeChannelAccess(context, postItem.channelId);

    return runAllPromises(
        Array.from(
            sliceIterable(postItem.commentsSummary.commentCountByAuthorId.keys(), 0, limit),
            accountId => getAccountOrThrow(context, postItem.spaceId, accountId),
        ),
    );
}

/**
 * Authorizes that the session user can access the provided post.
 * Implicitly also authorizes that the session user can access the channel the
 * post is in and the space the channel is in.
 */
export async function authorizePostAccess(
    context: RequestContext,
    id: PostId,
): Promise<{spaceId: SpaceId}> {
    const postItem = await PostsTable.getPartialItem(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId: id,
        },
        {
            attributes: ["spaceId", "channelId"],
        },
    );
    if (!postItem) throw new NotFoundError("Post not found");

    await authorizeChannelAccess(context, postItem.channelId);

    return {spaceId: postItem.spaceId};
}

/**
 * Add a new comment to a post.
 */
export async function createPostComment(
    context: RequestContext,
    {
        postId,
        parentCommentId,
        content,
    }: {
        postId: PostId;
        parentCommentId: number | null;
        content: MessageContent;
    },
): Promise<{
    id: number;
    createdTime: Date;
}> {
    return retryDynamoConditionCheckErrors(async () => {
        const [postItem] = await runAllPromiseThunks(
            async () => {
                const postItem = await PostsTable.getPartialItem(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "Attributes",
                        postId,
                    },
                    {
                        attributes: [
                            "spaceId",
                            "channelId",
                            "commentsSummary",
                            "updateLockVersion",
                        ],
                    },
                );
                if (!postItem) throw new NotFoundError("Post not found");
                await authorizeChannelAccess(context, postItem.channelId);

                return postItem;
            },
            async () => {
                if (typeof parentCommentId !== "number") return;

                const parentCommentItem = await PostsTable.getPartialItem(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "Comments",
                        postId,
                        commentId: parentCommentId,
                    },
                    {
                        attributes: [],
                    },
                );
                if (!parentCommentItem) throw new NotFoundError("Post parent comment not found");
            },
        );

        const commentId = postItem.commentsSummary.nextCommentId;
        const createdTime = new Date();
        const authorId = context.auth.getAccountId();

        const newCommentCountByAuthorId = new Map(postItem.commentsSummary.commentCountByAuthorId);
        newCommentCountByAuthorId.set(authorId, (newCommentCountByAuthorId.get(authorId) ?? 0) + 1);

        await DynamoTableSchema.executeTransaction(context, [
            PostsTable.transactionCreateItem({
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentId,
                authorId,
                createdTime,
                parentCommentId,
                content,
                contentUpdatedTime: null,
            }),
            PostsTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentId: postItem.commentsSummary.nextCommentId + 1,
                    commentCountByAuthorId: newCommentCountByAuthorId,
                },
                {updateLockVersion: postItem.updateLockVersion},
            ),
        ]);

        return {
            id: commentId,
            createdTime,
        };
    });
}

/**
 * Get a single post comment.
 */
export async function getPostComment(
    context: RequestContext,
    {postId, commentId}: {postId: PostId; commentId: number},
): Promise<PostCommentModel | null> {
    const [{spaceId}, item] = await runAllPromises([
        authorizePostAccess(context, postId),
        PostsTable.getItem(context, {
            partitionType: "Post",
            sortRangeType: "Comments",
            postId,
            commentId,
        }),
    ]);

    if (!item) return null;
    return createPostCommentModelFromItem(context, spaceId, item);
}

async function createPostCommentModelFromItem(
    context: RequestContext,
    spaceId: SpaceId,
    item: PostCommentItem,
): Promise<PostCommentModel> {
    return new PostCommentModel({
        id: item.commentId,
        author: await getAccountOrThrow(context, spaceId, item.authorId),
        createdTime: item.createdTime,
        parentCommentId: item.parentCommentId,
        content: item.content,
        contentUpdatedTime: item.contentUpdatedTime,
    });
}

/**
 * Update the content on one of your post comments.
 */
export function updatePostCommentContent(
    context: RequestContext,
    {postId, commentId, content}: {postId: PostId; commentId: number; content: MessageContent},
): Promise<{
    contentUpdatedTime: Date;
}> {
    return retryDynamoConditionCheckErrors(async () => {
        const [, item] = await runAllPromises([
            authorizePostAccess(context, postId),
            PostsTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentId,
            }),
        ]);

        if (!item) throw new NotFoundError("Post comment not found");

        if (item.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can only update post comments you authored");

        const contentUpdatedTime = new Date();
        await PostsTable.directlyUpdateItem(context, {...item, content, contentUpdatedTime});

        return {contentUpdatedTime};
    });
}

/**
 * Delete a single post comment.
 */
export function deletePostComment(
    context: RequestContext,
    {postId, commentId}: {postId: PostId; commentId: number},
): Promise<void> {
    return retryDynamoConditionCheckErrors(async () => {
        const [postItem, postCommentItem] = await runAllPromises([
            PostsTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            }),
            PostsTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentId,
            }),
        ]);

        if (!postItem) throw new NotFoundError("Post not found");
        if (!postCommentItem) throw new NotFoundError("Post comment not found");

        await authorizeChannelAccess(context, postItem.channelId);

        if (postCommentItem.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can only delete post comments you authored");

        const newCommentCountByAuthorId = new Map(postItem.commentsSummary.commentCountByAuthorId);

        const oldCommentCount = newCommentCountByAuthorId.get(postCommentItem.authorId) ?? 0;
        if (oldCommentCount <= 0)
            throw new InternalError(
                "Can not decrement comment count for account with a comment count of zero",
            );

        // If the account has deleted all their comments, then remove them from the
        // map entirely.
        if (oldCommentCount === 1) {
            newCommentCountByAuthorId.delete(postCommentItem.authorId);
        } else {
            newCommentCountByAuthorId.set(postCommentItem.authorId, oldCommentCount - 1);
        }

        await DynamoTableSchema.executeTransaction(context, [
            PostsTable.transactionDeleteItem(postCommentItem),
            PostsTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentId: postItem.commentsSummary.nextCommentId,
                    commentCountByAuthorId: newCommentCountByAuthorId,
                },
                {updateLockVersion: postItem.updateLockVersion},
            ),
        ]);
    });
}

/**
 * Gets both the post model and the first few comments for the post in
 * one request.
 */
export async function getPostAndCommentsFromStart(
    context: RequestContext,
    {
        postId,
        postCommentLimit,
    }: {
        postId: PostId;
        postCommentLimit: number;
    },
): Promise<{
    post: PostModel;
    hasMorePostCommentsAfter: boolean;
    postComments: Array<PostCommentModel>;
} | null> {
    // Start querying before authorization so our query runs in parallel
    // with authorization.
    const queryIterable = PostsTable.query(context, {
        startKey: {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        endKey: {
            partitionType: "Post",
            sortRangeType: "Comments",
            postId,
            commentId: Number.MAX_SAFE_INTEGER,
        },
        // Add two to the limit:
        //
        // - One for the post attributes item.
        // - One so we can determine whether there are more comments after.
        limit: postCommentLimit + 2,
    });

    let state: {
        spaceId: SpaceId;
        postPromise: Promise<PostModel>;
        postCommentPromises: Array<Promise<PostCommentModel>>;
        hasMorePostCommentsAfter: boolean;
    } | null = null;

    for await (const item of queryIterable) {
        switch (item.sortRangeType) {
            case "Attributes": {
                assert(state === null);

                await authorizeChannelAccess(context, item.channelId);

                state = {
                    spaceId: item.spaceId,
                    postPromise: createPostModelFromItem(context, item),
                    postCommentPromises: [],
                    hasMorePostCommentsAfter: false,
                };
                break;
            }
            case "Comments": {
                if (state === null)
                    throw new DataLossError("Found post comment item but no post attributes item");

                // For items outside our limit, we don't return them and instead mark that
                // there are more post comments.
                if (state.postCommentPromises.length >= postCommentLimit) {
                    state.hasMorePostCommentsAfter = true;
                    break;
                }

                state.postCommentPromises.push(
                    createPostCommentModelFromItem(context, state.spaceId, item),
                );
                break;
            }
            default:
                throw exhaustive(item);
        }
    }

    if (!state) return null;

    const [post, postComments] = await runAllPromises([
        state.postPromise,
        runAllPromises(state.postCommentPromises),
    ]);

    return {
        post,
        hasMorePostCommentsAfter: state.hasMorePostCommentsAfter,
        postComments,
    };
}

/**
 * Paginate through post comments from start to finish.
 */
export async function getPostCommentsFromStart(
    context: RequestContext,
    {
        postId,
        limit,
        afterCommentId,
        beforeCommentId,
    }: {
        postId: PostId;
        limit: number;
        afterCommentId: number | null;
        beforeCommentId: number | null;
    },
): Promise<{
    hasMoreCommentsAfter: boolean;
    comments: Array<PostCommentModel>;
}> {
    // Start querying before authorization so our query runs in parallel
    // with authorization.
    const queryIterable = PostsTable.query(context, {
        startKey: {
            partitionType: "Post",
            sortRangeType: "Comments",
            postId,
            commentId: typeof afterCommentId === "number" ? afterCommentId + 1 : 1,
        },
        endKey: {
            partitionType: "Post",
            sortRangeType: "Comments",
            postId,
            commentId:
                typeof beforeCommentId === "number" ? beforeCommentId - 1 : Number.MAX_SAFE_INTEGER,
        },
        // Add one to the limit so we can determine whether there are more
        // comments after.
        limit: limit + 1,
    });

    const {spaceId} = await authorizePostAccess(context, postId);

    const queriedComments = await parallelMapAsyncIterableToArray(
        queryIterable,
        async (item, index) => {
            // For items outside our limit, don't create a post comment model. We will
            // throw these away.
            if (index >= limit) return null;

            return createPostCommentModelFromItem(context, spaceId, item);
        },
    );

    // Drop any queried comments outside of our limit.
    const comments = queriedComments.slice(0, limit) as Array<PostCommentModel>;
    const hasMoreCommentsAfter = queriedComments.length > limit;

    return {comments, hasMoreCommentsAfter};
}

/**
 * Paginate through post comments from finish to start.
 */
export async function getPostCommentsFromEnd(
    context: RequestContext,
    {
        postId,
        limit,
        afterCommentId,
        beforeCommentId,
    }: {
        postId: PostId;
        limit: number;
        afterCommentId: number | null;
        beforeCommentId: number | null;
    },
): Promise<{
    hasMoreCommentsBefore: boolean;
    comments: Array<PostCommentModel>;
}> {
    // Base case: If we are loading before the first comment ID we know there are
    // no comments.
    if (beforeCommentId === 1) {
        return {comments: [], hasMoreCommentsBefore: false};
    }

    // Start querying before authorization so our query runs in parallel
    // with authorization.
    const queryIterable = PostsTable.query(context, {
        startKey: {
            partitionType: "Post",
            sortRangeType: "Comments",
            postId,
            commentId: typeof afterCommentId === "number" ? afterCommentId + 1 : 1,
        },
        endKey: {
            partitionType: "Post",
            sortRangeType: "Comments",
            postId,
            commentId:
                typeof beforeCommentId === "number" ? beforeCommentId - 1 : Number.MAX_SAFE_INTEGER,
        },
        // Add one to the limit so we can determine whether there are more
        // comments after.
        limit: limit + 1,
        // Scan backwards from `endKey` to `startKey` so we can get comments at the end
        // instead of start.
        descending: true,
    });

    const {spaceId} = await authorizePostAccess(context, postId);

    const queriedComments = await parallelMapAsyncIterableToArray(
        queryIterable,
        async (item, index) => {
            // For items outside our limit, don't create a post comment model. We will
            // throw these away.
            if (index >= limit) return null;

            return createPostCommentModelFromItem(context, spaceId, item);
        },
    );

    // Drop any queried comments outside of our limit.
    const comments = queriedComments.slice(0, limit).reverse() as Array<PostCommentModel>;
    const hasMoreCommentsBefore = queriedComments.length > limit;

    return {comments, hasMoreCommentsBefore};
}
