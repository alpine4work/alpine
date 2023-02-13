import {getAccountOrThrow} from "~/server/dynamo/accounts_table";
import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {getDynamoSeedConstants} from "~/server/dynamo/dynamo_seed_constants";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry_dynamo_condition_check_errors";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table";
import {
    MessageContent,
    MessageContentSchema,
    emptyMessageContent,
} from "~/shared/content/message_content_schema";
import {PostContent, PostContentSchema} from "~/shared/content/post_content_schema";
import {
    DataLossError,
    FailedPreconditionError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable";
import {generateId} from "~/shared/id/id";
import {AccountId, ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {ChannelModel} from "~/shared/models/channel_model";
import {MessagePayloadSchema} from "~/shared/models/message_interface";
import {
    PostCommentModel,
    PostModel,
    maxPostPreviewCommentAuthorCount,
} from "~/shared/models/post_model";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Schema} from "~/shared/schema/schema";

const ForumTable = DynamoTableSchema.new({
    name: "Forum",
    partitions: {
        Channel: {
            partitionKeyAttributes: {
                channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
            },
            sortRanges: {
                Attributes: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),

                        /** When was this channel created? */
                        createdTime: Schema.date,

                        /** The name of this channel. */
                        name: LabelStringSchema,

                        /** A description for the channel which will appear in a sidebar. */
                        description: MessageContentSchema.default(emptyMessageContent),
                    }),
                },
            },
        },
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

                        /** The last time at which the post's content was updated. */
                        contentUpdatedTime: Schema.date.nullable().default(null),

                        /**
                         * Information regarding the post's comments. Nested in an object so we can
                         * update it at once.
                         */
                        commentsSummary: Schema.object({
                            /**
                             * The index of the next comment.
                             */
                            nextCommentIndex: Schema.integer.min(0),

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
                        }),
                    }),
                },
                /**
                 * Comments on a post. Has all the attributes needed for a message in
                 * `MessageInterface`.
                 */
                Comments: {
                    sortKeyAttributes: {
                        commentIndex: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        authorId: Schema.id<AccountId>(),
                        createdTime: Schema.date,
                        payload: MessagePayloadSchema,
                    }),
                },
            },
        },
    },
});

const ChannelPostsIndex = ForumTable.addIndex({
    name: "ChannelPosts",
    itemTypes: [{partitionType: "Post", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
    },
    sortKeyAttributes: {
        createdTime: DynamoKeyAttributeSchema.date,
        postId: DynamoKeyAttributeSchema.id<PostId>(),
    },
});

type ChannelAttributesItem = DynamoTableItemType<typeof ForumTable, "Channel", "Attributes">;
type PostAttributesItem = DynamoTableItemType<typeof ForumTable, "Post", "Attributes">;
type PostCommentItem = DynamoTableItemType<typeof ForumTable, "Post", "Comments">;

export async function seedTestChannels(context: DynamoContext) {
    assert(process.env.NODE_ENV !== "production");
    const {testChannelId, defaultSpaceId} = getDynamoSeedConstants();

    await ForumTable.createItemIfNoneExists(context, {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId: testChannelId,
        spaceId: defaultSpaceId,
        createdTime: new Date(),
        name: "Test",
        description: emptyMessageContent,
    });
}

/**
 * Create a new channel.
 */
export async function createChannel(
    context: RequestContext,
    {spaceId, name}: {spaceId: SpaceId; name: string},
): Promise<ChannelModel> {
    await authorizeSpaceAccess(context, spaceId);

    const channelItem: ChannelAttributesItem = {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId: generateId(),
        spaceId,
        createdTime: new Date(),
        name,
        description: emptyMessageContent,
    };

    await ForumTable.createItem(context, channelItem);
    return createChannelModelFromItem(channelItem);
}

async function getChannelItem(
    context: RequestContext,
    id: ChannelId,
): Promise<ChannelAttributesItem | null> {
    const channelItem = await ForumTable.getItem(context, {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId: id,
    });
    if (!channelItem) return null;

    await authorizeSpaceAccess(context, channelItem.spaceId);
    return channelItem;
}

/**
 * Gets the channel object with the provided ID. Returns null if the channel
 * doesn't exist and throws an error if the channel exists but you don't have
 * access to the channel.
 */
export async function getChannel(
    context: RequestContext,
    id: ChannelId,
): Promise<ChannelModel | null> {
    const channelItem = await getChannelItem(context, id);
    if (!channelItem) return null;
    return createChannelModelFromItem(channelItem);
}

function createChannelModelFromItem(channelItem: ChannelAttributesItem): ChannelModel {
    return new ChannelModel({
        id: channelItem.channelId,
        spaceId: channelItem.spaceId,
        createdTime: channelItem.createdTime,
        name: channelItem.name,
        description: channelItem.description,
    });
}

/**
 * Authorize that the current user has access to a channel. Implicitly also authorizes
 * that the current user has access to the space the channel is in.
 */
export async function authorizeChannelAccess(
    context: RequestContext,
    id: ChannelId,
): Promise<void> {
    const channelItem = await getChannelItem(context, id);
    if (!channelItem) throw new NotFoundError("Channel not found");
}

/**
 * Updates the name of the channel.
 */
export async function updateChannelName(
    context: RequestContext,
    {
        channelId,
        name,
    }: {
        channelId: ChannelId;
        name: string;
    },
) {
    // Give the user a nice error message if there was an error validating the new
    // channel name.
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    await ForumTable.updateItem(
        context,
        {partitionType: "Channel", sortRangeType: "Attributes", channelId},
        async channelItem => {
            if (!channelItem) throw new NotFoundError("Channel not found");
            await authorizeSpaceAccess(context, channelItem.spaceId);

            return {
                ...channelItem,
                name,
            };
        },
    );
}

/**
 * Updates the description of the channel.
 */
export async function updateChannelDescription(
    context: RequestContext,
    {
        channelId,
        description,
    }: {
        channelId: ChannelId;
        description: MessageContent;
    },
) {
    await ForumTable.updateItem(
        context,
        {partitionType: "Channel", sortRangeType: "Attributes", channelId},
        async channelItem => {
            if (!channelItem) throw new NotFoundError("Channel not found");
            await authorizeSpaceAccess(context, channelItem.spaceId);

            return {
                ...channelItem,
                description,
            };
        },
    );
}

/**
 * A cursor pointing to a position in a channel's posts for use in pagination.
 * Needs to contain the `postId` on the off chance that two posts have the same
 * created time.
 */
export type ChannelPostsCursor = {
    readonly createdTime: Date;
    readonly postId: PostId;
};

/**
 * Get the latest posts in a channel in reverse chronological order. The newest
 * post will be the first in the array.
 */
export async function getChannelPosts(
    context: RequestContext,
    {
        channelId,
        limit,
        afterCursor,
    }: {
        channelId: ChannelId;
        limit: number;
        afterCursor?: ChannelPostsCursor;
    },
): Promise<{
    hasMorePosts: boolean;
    posts: ReadonlyArray<PostModel>;
}> {
    await authorizeChannelAccess(context, channelId);

    const queriedPosts = await parallelMapAsyncIterableToArray(
        ChannelPostsIndex.query(context, {
            partitionKey: {channelId},
            endSortKey: afterCursor ? afterCursor : undefined,
            isEndSortKeyExclusive: true,
            // Get one more post above the limit to determine if there are more posts. We
            // will throw the extra post away from the result set.
            limit: limit + 1,
            descending: true,
        }),
        async (item, index) => {
            if (index >= limit) return null;

            const postItem = await ForumTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId: item.postId,
            });

            // A post in the index may have been deleted.
            if (!postItem) return null;

            return createPostModelFromItem(context, postItem);
        },
    );

    const hasMorePosts = queriedPosts.length > limit;
    const posts = queriedPosts.slice(0, limit).filter(isNonNullable);

    return {
        hasMorePosts,
        posts,
    };
}

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
        contentUpdatedTime: null,
        commentsSummary: {
            nextCommentIndex: 0,
            commentCountByAuthorId: new Map(),
        },
    };

    await ForumTable.createItem(context, postItem);

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
    const postItem = await ForumTable.getItem(context, {
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
                sliceIterable(
                    item.commentsSummary.commentCountByAuthorId.keys(),
                    0,
                    maxPostPreviewCommentAuthorCount,
                ),
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
        contentUpdatedTime: item.contentUpdatedTime,
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
 * Update the contents of a post if you are the post's author.
 */
export async function updatePostContent(
    context: RequestContext,
    {postId, content}: {postId: PostId; content: PostContent},
): Promise<{contentUpdatedTime: Date}> {
    let contentUpdatedTime: Date | null = null;

    await ForumTable.updateItem(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        async postItem => {
            if (!postItem) throw new NotFoundError("Post not found");
            await authorizeChannelAccess(context, postItem.channelId);

            if (postItem.authorId !== context.auth.getAccountId())
                throw new PermissionDeniedError("Can only update post comments you authored");

            contentUpdatedTime = new Date(
                postItem.contentUpdatedTime
                    ? Math.max(postItem.contentUpdatedTime.getTime() + 1, Date.now())
                    : Date.now(),
            );

            return {
                ...postItem,
                content,
                contentUpdatedTime,
            };
        },
    );

    assert(contentUpdatedTime !== null);
    return {contentUpdatedTime};
}

/**
 * Get all the authors on a post to a certain limit.
 */
export async function getPostCommentAuthors(
    context: RequestContext,
    {postId, limit}: {postId: PostId; limit: number},
): Promise<Array<AccountModel>> {
    const postItem = await ForumTable.getPartialItem(
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
    const postItem = await ForumTable.getPartialItem(
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
        parentCommentIndex,
        content,
    }: {
        postId: PostId;
        parentCommentIndex: number | null;
        content: MessageContent;
    },
): Promise<{
    index: number;
    createdTime: Date;
}> {
    return retryDynamoConditionCheckErrors(async () => {
        const [postItem] = await runAllPromiseThunks(
            async () => {
                const postItem = await ForumTable.getPartialItem(
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
                if (typeof parentCommentIndex !== "number") return;

                const parentCommentItem = await ForumTable.getPartialItem(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "Comments",
                        postId,
                        commentIndex: parentCommentIndex,
                    },
                    {
                        attributes: [],
                    },
                );
                if (!parentCommentItem) throw new NotFoundError("Post parent comment not found");
            },
        );

        const commentIndex = postItem.commentsSummary.nextCommentIndex;
        const createdTime = new Date();
        const authorId = context.auth.getAccountId();

        const newCommentCountByAuthorId = new Map(postItem.commentsSummary.commentCountByAuthorId);
        newCommentCountByAuthorId.set(authorId, (newCommentCountByAuthorId.get(authorId) ?? 0) + 1);

        await DynamoTableSchema.executeTransaction(context, [
            ForumTable.transactionCreateItem({
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
                authorId,
                createdTime,
                payload: {
                    type: "Content",
                    parentMessageIndex: parentCommentIndex,
                    content,
                    contentUpdatedTime: null,
                },
            }),
            ForumTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentIndex: postItem.commentsSummary.nextCommentIndex + 1,
                    commentCountByAuthorId: newCommentCountByAuthorId,
                },
                {updateLockVersion: postItem.updateLockVersion},
            ),
        ]);

        return {
            index: commentIndex,
            createdTime,
        };
    });
}

/**
 * Get a single post comment.
 */
export async function getPostComment(
    context: RequestContext,
    {postId, commentIndex}: {postId: PostId; commentIndex: number},
): Promise<PostCommentModel | null> {
    const [{spaceId}, item] = await runAllPromises([
        authorizePostAccess(context, postId),
        ForumTable.getItem(context, {
            partitionType: "Post",
            sortRangeType: "Comments",
            postId,
            commentIndex,
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
        postId: item.postId,
        index: item.commentIndex,
        author: await getAccountOrThrow(context, spaceId, item.authorId),
        createdTime: item.createdTime,
        payload: item.payload,
    });
}

/**
 * Update the content on one of your post comments.
 */
export function updatePostCommentContent(
    context: RequestContext,
    {
        postId,
        commentIndex,
        content,
    }: {
        postId: PostId;
        commentIndex: number;
        content: MessageContent;
    },
): Promise<{
    contentUpdatedTime: Date;
}> {
    return retryDynamoConditionCheckErrors(async () => {
        const [, item] = await runAllPromises([
            authorizePostAccess(context, postId),
            ForumTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
            }),
        ]);

        if (!item) throw new NotFoundError("Post comment not found");

        if (item.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can only update post comments you authored");

        if (item.payload.type !== "Content")
            throw new FailedPreconditionError("Can not update comments with a non-content payload");

        const contentUpdatedTime = new Date(
            item.payload.contentUpdatedTime
                ? Math.max(item.payload.contentUpdatedTime.getTime() + 1, Date.now())
                : Date.now(),
        );

        await ForumTable.directlyUpdateItem(context, {
            ...item,
            payload: {
                ...item.payload,
                content,
                contentUpdatedTime,
            },
        });

        return {contentUpdatedTime};
    });
}

/**
 * Delete a single post comment.
 */
export function deletePostComment(
    context: RequestContext,
    {postId, commentIndex}: {postId: PostId; commentIndex: number},
): Promise<{deletedTime: Date}> {
    return retryDynamoConditionCheckErrors(async () => {
        const [postItem, postCommentItem] = await runAllPromises([
            ForumTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            }),
            ForumTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
            }),
        ]);

        if (!postItem) throw new NotFoundError("Post not found");
        if (!postCommentItem) throw new NotFoundError("Post comment not found");

        await authorizeChannelAccess(context, postItem.channelId);

        if (postCommentItem.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can only delete post comments you authored");

        if (postCommentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not delete comments with a non-content payload");

        const deletedTime = new Date(
            postCommentItem.payload.contentUpdatedTime
                ? Math.max(postCommentItem.payload.contentUpdatedTime.getTime() + 1, Date.now())
                : Date.now(),
        );

        await ForumTable.directlyUpdateItem(context, {
            ...postCommentItem,
            payload: {type: "Deleted", deletedTime},
        });

        return {deletedTime};
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
    postComments: Array<PostCommentModel>;
} | null> {
    // Start querying before authorization so our query runs in parallel
    // with authorization.
    const queryIterable = ForumTable.query(context, {
        partitionKey: {
            partitionType: "Post",
            postId,
        },
        startSortKey: {
            sortRangeType: "Attributes",
        },
        endSortKey: {
            sortRangeType: "Comments",
            commentIndex: Number.MAX_SAFE_INTEGER,
        },
        // Add one to the limit for the post attributes item.
        limit: postCommentLimit + 1,
    });

    let state: {
        spaceId: SpaceId;
        postPromise: Promise<PostModel>;
        postCommentPromises: Array<Promise<PostCommentModel>>;
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
                };
                break;
            }
            case "Comments": {
                if (state === null)
                    throw new DataLossError("Found post comment item but no post attributes item");

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

    const lastPostCommentIndex =
        postComments.length > 0 ? postComments[postComments.length - 1]!.index : -1;

    return {
        post:
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            post.commentCount < lastPostCommentIndex + 1
                ? post.clone({commentCount: lastPostCommentIndex + 1})
                : post,
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
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        postId: PostId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<PostCommentModel>;
}> {
    // Start querying before authorization so our query runs in parallel
    // with authorization.
    const queryIterable = ForumTable.query(context, {
        partitionKey: {
            partitionType: "Post",
            postId,
        },
        startSortKey: {
            sortRangeType: "Comments",
            commentIndex: typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
        },
        endSortKey: {
            sortRangeType: "Comments",
            commentIndex:
                typeof beforeCommentIndex === "number"
                    ? beforeCommentIndex - 1
                    : Number.MAX_SAFE_INTEGER,
        },
        limit,
    });

    const postItem = await ForumTable.getPartialItem(
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

    const comments = await parallelMapAsyncIterableToArray(queryIterable, item =>
        createPostCommentModelFromItem(context, postItem.spaceId, item),
    );

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            reduceIterable(
                postItem.commentsSummary.commentCountByAuthorId.values(),
                (commentCount, authorCommentCount) => commentCount + authorCommentCount,
                0,
            ),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
    };
}

/**
 * Paginate through post comments from finish to start.
 */
export async function getPostCommentsFromEnd(
    context: RequestContext,
    {
        postId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        postId: PostId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    commentCount: number;
    comments: Array<PostCommentModel>;
}> {
    // Start querying before authorization so our query runs in parallel
    // with authorization.
    const queryIterable =
        typeof beforeCommentIndex !== "number" || beforeCommentIndex > 0
            ? ForumTable.query(context, {
                  partitionKey: {
                      partitionType: "Post",
                      postId,
                  },
                  startSortKey: {
                      sortRangeType: "Comments",
                      commentIndex:
                          typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
                  },
                  endSortKey: {
                      sortRangeType: "Comments",
                      commentIndex:
                          typeof beforeCommentIndex === "number"
                              ? beforeCommentIndex - 1
                              : Number.MAX_SAFE_INTEGER,
                  },
                  limit,
                  // Scan backwards from `endSortKey` to `startSortKey` so we can get comments
                  // at the end instead of start.
                  descending: true,
              })
            : (async function* () {})();

    const postItem = await ForumTable.getPartialItem(
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

    const comments = await parallelMapAsyncIterableToArray(queryIterable, item =>
        createPostCommentModelFromItem(context, postItem.spaceId, item),
    );

    // We queried in descending order so put comments back in the right order.
    comments.reverse();

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            reduceIterable(
                postItem.commentsSummary.commentCountByAuthorId.values(),
                (commentCount, authorCommentCount) => commentCount + authorCommentCount,
                0,
            ),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
    };
}
