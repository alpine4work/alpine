import {getAccountOrThrow} from "~/server/dynamo/accounts_table";
import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {getDynamoSeedConstants} from "~/server/dynamo/dynamo_seed_constants";
import {getContentReferencesForNode} from "~/server/dynamo/helpers/get_content_references";
import {createMessagePayloadModel} from "~/server/dynamo/helpers/messaging/create_message_payload_model";
import {getMessageChangeLogExpirationTimeFromChangeTime} from "~/server/dynamo/helpers/messaging/get_message_change_log_expiration_time_from_change_time";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
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
    InternalError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise";
import {generateId} from "~/shared/id/id";
import {AccountId, ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {MessageChange, getMessageChangeTime} from "~/shared/messaging/message_change_schema";
import {AccountModel} from "~/shared/models/account_model";
import {ChannelModel, ChannelPreviewModel} from "~/shared/models/channel_model";
import {MessagePayloadSchema} from "~/shared/models/message_model";
import {
    PostCommentModel,
    PostModel,
    maxPostPreviewCommentAuthorCount,
} from "~/shared/models/post_model";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Schema} from "~/shared/schema/schema";

const ForumTable = DynamoTableSchema.new({
    name: "Forum",
    partitions: [
        {
            name: "Channel",
            partitionKeyAttributes: {
                channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
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
            ],
        },
        {
            name: "Post",
            partitionKeyAttributes: {
                postId: DynamoKeyAttributeSchema.id<PostId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
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
                             * The last time a comment was changed. This should equal the `changeTime` of
                             * the highest item in `CommentChangeLog`.
                             */
                            lastChangeTime: Schema.date.nullable().default(null),

                            /**
                             * All the accounts which have commented on the post and the number of comments
                             * they have made. The map is ordered by when the account first commented on
                             * the post.
                             *
                             * This map can grow unbounded. When a user deletes a comment it leaves a
                             * gravestone so comment counts should never be decremented.
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
                {
                    name: "Comments",
                    sortKeyAttributes: {
                        commentIndex: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        authorId: Schema.id<AccountId>(),
                        createdTime: Schema.date,
                        payload: MessagePayloadSchema,
                    }),
                },

                /**
                 * We keep a log of changes to comments so that when backfilling for realtime
                 * we can send any missed updates between the last time data was loaded and
                 * the backfill.
                 *
                 * `changeTime` should be monotonically increasing which is managed by
                 * `lastChangeTime` in `commentsSummary`.
                 *
                 * This log does not include when comments are created, only updated or
                 * deleted. Because comment indexes are dense we can take the last seen comment
                 * index and load comments after that to backfill.
                 *
                 * Log items will expire after a certain amount of time. If a client hasn't
                 * backfilled in a long time it will need to fully reload since we won't know
                 * what changed.
                 */
                {
                    name: "CommentChangeLog",
                    sortKeyAttributes: {
                        changeTime: DynamoKeyAttributeSchema.date,
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        commentIndex: Schema.integer,
                        change: Schema.union({
                            UpdateContent: Schema.object({
                                type: Schema.value("UpdateContent"),
                                content: MessageContentSchema,
                                // `contentUpdatedTime` is the `changeTime` sort key attribute. We don't
                                // duplicate it here.
                            }),
                            Delete: Schema.object({
                                type: Schema.value("Delete"),
                                // `deletedTime` is the `changeTime` sort key attribute. We don't
                                // duplicate it here.
                            }),
                        }),
                    }),
                },
            ],
        },
    ],
});

const ChannelPostsIndex = ForumTable.addIndex({
    name: "ChannelPosts",
    itemTypes: [{partitionType: "Post", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
    },
    sortKeyAttributes: {
        createdTime: DynamoKeyAttributeSchema.date,
        // Include the post ID in the index sort key so if two posts have the same
        // created time we have a deterministic ordering between them.
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
): Promise<{
    id: ChannelId;
    createdTime: Date;
}> {
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

    return {
        id: channelItem.channelId,
        createdTime: channelItem.createdTime,
    };
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
    const channelItem = await ForumTable.getItem(context, {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId: id,
    });
    if (!channelItem) return null;

    await authorizeSpaceAccess(context, channelItem.spaceId);

    return new ChannelModel({
        id: channelItem.channelId,
        spaceId: channelItem.spaceId,
        createdTime: channelItem.createdTime,
        name: channelItem.name,
        description: {
            doc: channelItem.description,
            references: await getContentReferencesForNode(
                context,
                channelItem.spaceId,
                channelItem.description,
            ),
        },
    });
}

/**
 * Gets a preview channel object with the provided ID. Returns null if the
 * channel doesn't exist and throws an error if the channel exists but you
 * don't have access to the channel.
 */
export async function getChannelPreview(
    context: RequestContext,
    id: ChannelId,
): Promise<ChannelPreviewModel | null> {
    const channelItem = await ForumTable.getPartialItem(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Attributes",
            channelId: id,
        },
        {
            attributes: ["spaceId", "createdTime", "name"],
        },
    );
    if (!channelItem) return null;

    await authorizeSpaceAccess(context, channelItem.spaceId);

    return new ChannelPreviewModel({
        id: channelItem.channelId,
        spaceId: channelItem.spaceId,
        createdTime: channelItem.createdTime,
        name: channelItem.name,
    });
}

/**
 * Authorize that the current user has access to a channel. Implicitly also authorizes
 * that the current user has access to the space the channel is in.
 */
export async function authorizeChannelAccess(
    context: RequestContext,
    id: ChannelId,
): Promise<ChannelPreviewModel> {
    const channel = await getChannelPreview(context, id);
    if (!channel) throw new NotFoundError("Channel not found");
    return channel;
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
    const channelPromise = authorizeChannelAccess(context, channelId);

    const [, queriedPosts] = await runAllPromises([
        channelPromise,
        parallelMapAsyncIterableToArray(
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

                return createPostModelFromItem(context, channelPromise, postItem);
            },
        ),
    ]);

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
        // NOTE(calebmer): Our tests override `Date.now()` to mock a fake time. So use
        // this slightly awkward form to let tests mock different times for post
        // creation.
        createdTime: new Date(Date.now()),
        authorId: context.auth.getAccountId(),
        content,
        contentUpdatedTime: null,
        commentsSummary: {
            nextCommentIndex: 0,
            lastChangeTime: null,
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

    return createPostModelFromItem(
        context,
        authorizeChannelAccess(context, postItem.channelId),
        postItem,
    );
}

async function createPostModelFromItem(
    context: RequestContext,
    channelPromise: MaybePromise<ChannelPreviewModel>,
    item: PostAttributesItem,
): Promise<PostModel> {
    const [channel, author, previewCommentAuthors, contentReferences] = await runAllPromises([
        channelPromise,
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
        getContentReferencesForNode(context, item.spaceId, item.content),
    ]);

    assert(channel.id === item.channelId);

    return new PostModel({
        id: item.postId,
        spaceId: item.spaceId,
        channel,
        createdTime: item.createdTime,
        author,
        content: {
            doc: item.content,
            references: contentReferences,
        },
        contentUpdatedTime: item.contentUpdatedTime,
        commentCount: reduceIterable(
            item.commentsSummary.commentCountByAuthorId.values(),
            (commentCount, authorCommentCount) => commentCount + authorCommentCount,
            0,
        ),
        lastCommentChangeTime: item.commentsSummary.lastChangeTime,
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
    return context.dynamo.retryTransaction(async context => {
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
                    lastChangeTime: postItem.commentsSummary.lastChangeTime,
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
    const [author, payload] = await runAllPromises([
        getAccountOrThrow(context, spaceId, item.authorId),
        createMessagePayloadModel(context, spaceId, item.payload),
    ]);

    return new PostCommentModel({
        postId: item.postId,
        index: item.commentIndex,
        author,
        createdTime: item.createdTime,
        payload,
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
    return context.dynamo.retryTransaction(async context => {
        const [postItem, commentItem] = await runAllPromises([
            ForumTable.getPartialItem(
                context,
                {
                    partitionType: "Post",
                    sortRangeType: "Attributes",
                    postId,
                },
                {
                    attributes: [
                        "channelId",
                        "createdTime",
                        "commentsSummary",
                        "updateLockVersion",
                    ],
                },
            ),
            ForumTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
            }),
        ]);

        if (!postItem) throw new NotFoundError("Post not found");
        if (!commentItem) throw new NotFoundError("Post comment not found");

        await authorizeChannelAccess(context, postItem.channelId);

        if (commentItem.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can only update post comments you authored");

        if (commentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not update comments with a non-content payload");

        const contentUpdatedTime = new Date(
            Math.max(
                (postItem.commentsSummary.lastChangeTime ?? postItem.createdTime).getTime() + 1,
                Date.now(),
            ),
        );

        // `lastChangeTime` should always be greater than or equal
        // to `contentUpdatedTime`.
        assert(
            !commentItem.payload.contentUpdatedTime ||
                contentUpdatedTime > commentItem.payload.contentUpdatedTime,
        );

        await DynamoTableSchema.executeTransaction(context, [
            ForumTable.transactionDirectlyUpdateItem({
                ...commentItem,
                payload: {
                    ...commentItem.payload,
                    content,
                    contentUpdatedTime,
                },
            }),
            ForumTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentIndex: postItem.commentsSummary.nextCommentIndex,
                    lastChangeTime: contentUpdatedTime,
                    commentCountByAuthorId: postItem.commentsSummary.commentCountByAuthorId,
                },
                {updateLockVersion: postItem.updateLockVersion},
            ),
            // Create-or-replace is safe because the change time is guaranteed to be unique
            // and monotonically increasing.
            ForumTable.transactionCreateOrReplaceItem({
                partitionType: "Post",
                sortRangeType: "CommentChangeLog",
                postId,
                changeTime: contentUpdatedTime,
                commentIndex: commentItem.commentIndex,
                change: {
                    type: "UpdateContent",
                    content,
                },
                expirationTime: getMessageChangeLogExpirationTimeFromChangeTime(contentUpdatedTime),
            }),
        ]);

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
    return context.dynamo.retryTransaction(async context => {
        const [postItem, commentItem] = await runAllPromises([
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
        if (!commentItem) throw new NotFoundError("Post comment not found");

        await authorizeChannelAccess(context, postItem.channelId);

        if (commentItem.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can only delete post comments you authored");

        if (commentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not delete comments with a non-content payload");

        const deletedTime = new Date(
            Math.max(
                (postItem.commentsSummary.lastChangeTime ?? postItem.createdTime).getTime() + 1,
                Date.now(),
            ),
        );

        // `lastChangeTime` should always be greater than or equal
        // to `deletedTime`.
        assert(
            !commentItem.payload.contentUpdatedTime ||
                deletedTime > commentItem.payload.contentUpdatedTime,
        );

        await DynamoTableSchema.executeTransaction(context, [
            ForumTable.transactionDirectlyUpdateItem({
                ...commentItem,
                payload: {type: "Deleted", deletedTime},
            }),
            ForumTable.transactionDirectlyUpdateItemAttribute(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentIndex: postItem.commentsSummary.nextCommentIndex,
                    lastChangeTime: deletedTime,
                    commentCountByAuthorId: postItem.commentsSummary.commentCountByAuthorId,
                },
                {updateLockVersion: postItem.updateLockVersion},
            ),
            // Create-or-replace is safe because the change time is guaranteed to be unique
            // and monotonically increasing.
            ForumTable.transactionCreateOrReplaceItem({
                partitionType: "Post",
                sortRangeType: "CommentChangeLog",
                postId,
                changeTime: deletedTime,
                commentIndex: commentItem.commentIndex,
                change: {type: "Delete"},
                expirationTime: getMessageChangeLogExpirationTimeFromChangeTime(deletedTime),
            }),
        ]);

        return {deletedTime};
    });
}

/**
 * Gets both the post model and the first few comments for the post in
 * one request.
 */
export async function getPostAndInitialComments(
    context: RequestContext,
    {
        postId,
        commentLimit,
    }: {
        postId: PostId;
        commentLimit: number;
    },
): Promise<{
    post: PostModel;
    initialComments: Array<PostCommentModel>;
    initialOtherReferencedComments: Array<PostCommentModel>;
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
        limit: commentLimit + 1,
    });

    let state: {
        spaceId: SpaceId;
        postPromise: Promise<PostModel>;
        commentPromises: Array<Promise<PostCommentModel>>;
    } | null = null;

    const commentIndexes = new Set<number>();
    const parentCommentIndexes = new Set<number>();

    for await (const item of queryIterable) {
        switch (item.sortRangeType) {
            case "Attributes": {
                assert(state === null);

                state = {
                    spaceId: item.spaceId,
                    postPromise: createPostModelFromItem(
                        context,
                        authorizeChannelAccess(context, item.channelId),
                        item,
                    ),
                    commentPromises: [],
                };
                break;
            }
            case "Comments": {
                if (state === null)
                    throw new DataLossError("Found post comment item but no post attributes item");

                commentIndexes.add(item.commentIndex);

                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null)
                    parentCommentIndexes.add(item.payload.parentMessageIndex);

                state.commentPromises.push(
                    createPostCommentModelFromItem(context, state.spaceId, item),
                );
                break;
            }
            default:
                throw exhaustive(item);
        }
    }

    if (!state) return null;
    const {spaceId} = state;

    const [post, comments, otherReferencedComments] = await runAllPromises([
        state.postPromise,
        runAllPromises(state.commentPromises),
        runAllPromises(
            filterMapIterable(parentCommentIndexes, parentCommentIndex => {
                if (commentIndexes.has(parentCommentIndex)) return null;

                return (async () => {
                    const commentItem = await ForumTable.getItem(context, {
                        partitionType: "Post",
                        sortRangeType: "Comments",
                        postId,
                        commentIndex: parentCommentIndex,
                    });
                    if (!commentItem) throw new InternalError("Parent comment not found");

                    return createPostCommentModelFromItem(context, spaceId, commentItem);
                })();
            }),
        ),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        post:
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            post.commentCount < lastCommentIndex + 1
                ? post.clone({commentCount: lastCommentIndex + 1})
                : post,
        initialComments: comments,
        initialOtherReferencedComments: otherReferencedComments,
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
    otherReferencedComments: Array<PostCommentModel>;
    lastCommentChangeTime: Date | null;
}> {
    const postItemPromise = (async () => {
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
        return postItem;
    })();

    const [postItem, {comments, otherReferencedComments}] = await runAllPromises([
        postItemPromise,
        getPostCommentsFromStartAssumingAuthorizedPost(context, {
            postId,
            getSpaceId: () => postItemPromise.then(({spaceId}) => spaceId),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
        postItemPromise.then(({channelId}) => authorizeChannelAccess(context, channelId)),
    ]);

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
        otherReferencedComments,
        lastCommentChangeTime: postItem.commentsSummary.lastChangeTime,
    };
}

async function getPostCommentsFromStartAssumingAuthorizedPost(
    context: RequestContext,
    {
        postId,
        getSpaceId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        postId: PostId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    comments: Array<PostCommentModel>;
    otherReferencedComments: Array<PostCommentModel>;
}> {
    const commentIndexes = new Set<number>();
    const parentCommentIndexes = new Set<number>();

    // Don't wait for `getSpaceId` to start our comment query.
    let spaceIdPromise: Promise<SpaceId> | null = null;
    let spaceId: SpaceId | null = null;

    const commentPromises = await arrayFromAsyncIterable(
        mapAsyncIterableIterator(
            ForumTable.query(context, {
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
            }),
            async item => {
                commentIndexes.add(item.commentIndex);

                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null)
                    parentCommentIndexes.add(item.payload.parentMessageIndex);

                if (spaceIdPromise === null) spaceIdPromise = getSpaceId();
                if (spaceId === null) spaceId = await spaceIdPromise;
                return createPostCommentModelFromItem(context, spaceId, item);
            },
        ),
    );

    const [comments, otherReferencedComments] = await runAllPromises([
        runAllPromises(commentPromises),
        runAllPromises(
            filterMapIterable(parentCommentIndexes, parentCommentIndex => {
                if (commentIndexes.has(parentCommentIndex)) return null;

                return (async () => {
                    const commentItem = await ForumTable.getItem(context, {
                        partitionType: "Post",
                        sortRangeType: "Comments",
                        postId,
                        commentIndex: parentCommentIndex,
                    });
                    if (!commentItem) throw new InternalError("Parent comment not found");

                    if (spaceIdPromise === null) spaceIdPromise = getSpaceId();
                    if (spaceId === null) spaceId = await spaceIdPromise;
                    return createPostCommentModelFromItem(context, spaceId, commentItem);
                })();
            }),
        ),
    ]);

    return {
        comments,
        otherReferencedComments,
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
    otherReferencedComments: Array<PostCommentModel>;
    lastCommentChangeTime: Date | null;
}> {
    const postItemPromise = (async () => {
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
        return postItem;
    })();

    const [postItem, {comments, otherReferencedComments}] = await runAllPromises([
        postItemPromise,
        getPostCommentsFromEndAssumingAuthorizedPost(context, {
            postId,
            getSpaceId: () => postItemPromise.then(({spaceId}) => spaceId),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
        postItemPromise.then(({channelId}) => authorizeChannelAccess(context, channelId)),
    ]);

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
        otherReferencedComments,
        lastCommentChangeTime: postItem.commentsSummary.lastChangeTime,
    };
}

async function getPostCommentsFromEndAssumingAuthorizedPost(
    context: RequestContext,
    {
        postId,
        getSpaceId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        postId: PostId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    comments: Array<PostCommentModel>;
    otherReferencedComments: Array<PostCommentModel>;
}> {
    const commentIndexes = new Set<number>();
    const parentCommentIndexes = new Set<number>();

    // Don't wait for `getSpaceId` to start our comment query.
    let spaceIdPromise: Promise<SpaceId> | null = null;
    let spaceId: SpaceId | null = null;

    const commentPromises = await arrayFromAsyncIterable(
        mapAsyncIterableIterator(
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
                : (async function* () {})(),
            async item => {
                commentIndexes.add(item.commentIndex);

                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null)
                    parentCommentIndexes.add(item.payload.parentMessageIndex);

                if (spaceIdPromise === null) spaceIdPromise = getSpaceId();
                if (spaceId === null) spaceId = await spaceIdPromise;
                return createPostCommentModelFromItem(context, spaceId, item);
            },
        ),
    );

    const [comments, otherReferencedComments] = await runAllPromises([
        runAllPromises(commentPromises),
        runAllPromises(
            filterMapIterable(parentCommentIndexes, parentCommentIndex => {
                if (commentIndexes.has(parentCommentIndex)) return null;

                return (async () => {
                    const commentItem = await ForumTable.getItem(context, {
                        partitionType: "Post",
                        sortRangeType: "Comments",
                        postId,
                        commentIndex: parentCommentIndex,
                    });
                    if (!commentItem) throw new InternalError("Parent comment not found");

                    if (spaceIdPromise === null) spaceIdPromise = getSpaceId();
                    if (spaceId === null) spaceId = await spaceIdPromise;
                    return createPostCommentModelFromItem(context, spaceId, commentItem);
                })();
            }),
        ),
    ]);

    // We queried in descending order so put comments back in the right order.
    comments.reverse();
    otherReferencedComments.reverse();

    return {
        comments,
        otherReferencedComments,
    };
}

export type PostCommentChangesResult =
    | {
          type: "Available";
          changes: Array<MessageChange>;
      }
    | {
          type: "Unavailable";
      };

/**
 * Backfills any missing comments or comment updates for a client. The client
 * provides what it knows to be the comment count and last change time then we
 * return any new comments or changes since then.
 *
 * We run this when the client establishes a new realtime connection to catch
 * the client up between their last data load and the time the realtime
 * connection was established.
 *
 * `newCommentLimit` allows you to load some new comments that the client
 * may be missing but only up to the limit.
 *
 * We do not keep a log of post comment changes around forever, so it's
 * possible that you get an `Unavailable` result for
 * `commentChangesResult`. When this happens you should throw away all data
 * your client has loaded and try loading the data again.
 */
export async function backfillPostComments(
    context: RequestContext,
    {
        postId,
        clientCommentCount,
        clientLastCommentChangeTime,
        newCommentLimit,
    }: {
        postId: PostId;
        clientCommentCount: number;
        clientLastCommentChangeTime: Date | null;
        newCommentLimit: number;
    },
): Promise<{
    commentCount: number;
    lastCommentChangeTime: Date | null;
    newComments: Array<PostCommentModel>;
    newOtherReferencedComments: Array<PostCommentModel>;
    commentChangesResult: PostCommentChangesResult;
}> {
    const postItemPromise = (async () => {
        const postItem = await ForumTable.getPartialItem(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            },
            {
                attributes: ["spaceId", "channelId", "createdTime", "commentsSummary"],
            },
        );
        if (!postItem) throw new NotFoundError("Post not found");
        return postItem;
    })();

    const [postItem, {comments, otherReferencedComments}, commentChangesResult] =
        await runAllPromises([
            postItemPromise,
            getPostCommentsFromStartAssumingAuthorizedPost(context, {
                postId,
                getSpaceId: () => postItemPromise.then(({spaceId}) => spaceId),
                limit: newCommentLimit,
                afterCommentIndex: clientCommentCount - 1,
                beforeCommentIndex: null,
            }),
            postItemPromise.then(postItem =>
                queryPostCommentChangeLogAssumingAuthorizedPost(context, {
                    postItem,
                    lastCommentChangeTime: clientLastCommentChangeTime,
                }),
            ),
            postItemPromise.then(({channelId}) => authorizeChannelAccess(context, channelId)),
        ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    const lastCommentChangeTime =
        commentChangesResult.type === "Available" && commentChangesResult.changes.length > 0
            ? getMessageChangeTime(
                  commentChangesResult.changes[commentChangesResult.changes.length - 1]!,
              )
            : null;

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
        lastCommentChangeTime:
            lastCommentChangeTime &&
            // Make sure `lastCommentChangeTime` is consistent with
            // `commentChangesResult` in case of eventual consistency race conditions.
            (!postItem.commentsSummary.lastChangeTime ||
                lastCommentChangeTime > postItem.commentsSummary.lastChangeTime)
                ? lastCommentChangeTime
                : postItem.commentsSummary.lastChangeTime,
        newComments: comments,
        newOtherReferencedComments: otherReferencedComments,
        commentChangesResult,
    };
}

async function queryPostCommentChangeLogAssumingAuthorizedPost(
    context: RequestContext,
    {
        postItem,
        lastCommentChangeTime,
    }: {
        postItem: Pick<
            PostAttributesItem,
            "postId" | "spaceId" | "createdTime" | "commentsSummary"
        >;
        lastCommentChangeTime: Date | null;
    },
): Promise<PostCommentChangesResult> {
    // No changes occurred during the backfill period, there is nothing we need
    // to query.
    if (postItem.commentsSummary.lastChangeTime?.getTime() === lastCommentChangeTime?.getTime())
        return {type: "Available", changes: []};

    const lastCommentChangeExpirationTime = getMessageChangeLogExpirationTimeFromChangeTime(
        lastCommentChangeTime ?? postItem.createdTime,
    );

    // If our last change item has expired then other relevant changelog entries
    // may have also expired. The client will need to fully reset its state since
    // we don't have the data necessary to backfill.
    //
    // We subtract one day from the expiration time in this check in case our clock
    // disagrees with DynamoDB's time-to-live clock (clock skew). If our clock is
    // ahead and we believe an item exists that DynamoDB has in fact deleted that
    // would be sad. One day feels like sufficient clock skew buffer.
    if (lastCommentChangeExpirationTime.getTime() - 1000 * 60 * 60 * 24 < Date.now())
        return {type: "Unavailable"};

    const changes = await parallelMapAsyncIterableToArray(
        ForumTable.query(context, {
            partitionKey: {
                partitionType: "Post",
                postId: postItem.postId,
            },
            startSortKey: {
                sortRangeType: "CommentChangeLog",
                changeTime: new Date((lastCommentChangeTime ?? postItem.createdTime).getTime() + 1),
            },
            endSortKey: {
                sortRangeType: "CommentChangeLog",
                changeTime: DynamoKeyAttributeSchema.date.maxValue,
            },
            limit: "All",
        }),
        async (item): Promise<MessageChange> => {
            switch (item.change.type) {
                case "UpdateContent": {
                    return {
                        type: "UpdateContent",
                        index: item.commentIndex,
                        content: {
                            doc: item.change.content,
                            references: await getContentReferencesForNode(
                                context,
                                postItem.spaceId,
                                item.change.content,
                            ),
                        },
                        contentUpdatedTime: item.changeTime,
                    };
                }
                case "Delete": {
                    return {
                        type: "Delete",
                        index: item.commentIndex,
                        deletedTime: item.changeTime,
                    };
                }
                default:
                    throw exhaustive(item.change);
            }
        },
    );

    return {type: "Available", changes};
}
