import {getAccountOrThrow} from "~/server/dynamo/accounts_table";
import {authorizeChannelAccess, getChannel} from "~/server/dynamo/channels_table";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo_transaction_entry";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry_dynamo_condition_check_errors";
import {AccountModel} from "~/shared/accounts/account_model";
import {
    DataLossError,
    FailedPreconditionError,
    InternalError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error";
import {runAllPromiseThunks, runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array";
import {generateId} from "~/shared/id/id";
import {AccountId, ChannelId, PostId, SpaceId} from "~/shared/id/types/id_types";
import {
    PostCommentContent,
    PostCommentContentSchema,
} from "~/shared/posts/post_comment_content_schema";
import {PostContent, PostContentSchema} from "~/shared/posts/post_content_schema";
import {PostModel, PostReplyCommentModel, PostRootCommentModel} from "~/shared/posts/post_model";
import {Schema, SchemaType} from "~/shared/schema/schema";

/**
 * An object summarizing comments left on a post. Also used to summarize reply
 * comments left on a root comment.
 */
const PostCommentsSummarySchema = Schema.object({
    /**
     * This number is used to determine comment identifier numbers.
     *
     * It is incremented by 1 whenever we add a comment and never decremented. If
     * we decremented the number we may have comments with duplicate identifiers.
     *
     * You should not use this as the total comment count since it does not
     * consider deleted comments.
     */
    sequenceNumber: Schema.integer.min(0),

    /**
     * All the accounts which have commented on the post and the number of comments
     * they have made. The map is ordered by when the account first commented on
     * the post.
     *
     * This map can grow unbounded but we do need the total number of accounts to
     * comment.
     */
    commentCountByAuthorId: Schema.map(Schema.id<AccountId>(), Schema.integer.min(1)),
});

type PostCommentsSummary = SchemaType<typeof PostCommentsSummarySchema>;

const emptyPostCommentsSummary: PostCommentsSummary = {
    sequenceNumber: 0,
    commentCountByAuthorId: new Map(),
};

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
                         * Summary of the comments left on this post. Both root comments
                         * and reply comments. However the `sequenceNumber` is only for root comments.
                         */
                        commentsSummary:
                            PostCommentsSummarySchema.default(emptyPostCommentsSummary),
                    }),
                },
                RootComments: {
                    sortKeyAttributes: {
                        /**
                         * Comment identifier. Comment identifiers are an auto-incrementing integer
                         * sequence. That way we maintain a strict comment ordering.
                         *
                         * The next number in the sequence is maintained in the post item's
                         * `commentsSummary`.
                         */
                        rootCommentNumber: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        /** When was this comment created? */
                        createdTime: Schema.date,

                        /**
                         * If this comment was deleted but we need to keep the comment around because
                         * it has some replies, we set this to true marking the comment as a gravestone
                         * comment. If all replies are deleted then we will delete this comment too.
                         *
                         * We use a separate property instead of clearing `authorId` and `content` so
                         * that we can determine if a comment is a gravestone by reading a single property.
                         */
                        isDeletedButHasReplies: Schema.boolean,

                        /** Which account created this post? */
                        authorId: Schema.id<AccountId>(),

                        /** The contents of this comment. */
                        content: PostCommentContentSchema,

                        /** A summary of replies to this root comment. */
                        replyCommentsSummary: PostCommentsSummarySchema,
                    }),
                },
                ReplyComments: {
                    sortKeyAttributes: {
                        /** The comment number this is a reply to. */
                        rootCommentNumber: DynamoKeyAttributeSchema.integer,

                        /**
                         * Reply comment identifier. Reply comment identifiers are an auto-incrementing
                         * integer sequence. That way we maintain a strict comment ordering.
                         *
                         * The next number in the sequence is maintained in the
                         * `replyCommentsSummary` of the root comment this is a child of.
                         */
                        replyCommentNumber: DynamoKeyAttributeSchema.integer,
                    },
                    attributes: Schema.object({
                        /** When was this comment created? */
                        createdTime: Schema.date,

                        /** Which account created this post? */
                        authorId: Schema.id<AccountId>(),

                        /** The contents of this comment. */
                        content: PostCommentContentSchema,
                    }),
                },
            },
        },
    },
});

type PostAttributesItem = DynamoTableItemType<typeof PostsTable, "Post", "Attributes">;
type PostRootCommentItem = DynamoTableItemType<typeof PostsTable, "Post", "RootComments">;
type PostReplyCommentItem = DynamoTableItemType<typeof PostsTable, "Post", "ReplyComments">;

/**
 * Create a new post by the current account in the provided channel.
 */
export async function createPost(
    context: RequestContext,
    {channelId, content}: {channelId: ChannelId; content: PostContent},
): Promise<{
    id: PostId;
    spaceId: SpaceId;
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
        commentsSummary: emptyPostCommentsSummary,
    };

    await PostsTable.createItem(context, postItem);

    return {
        id: postItem.postId,
        spaceId: channel.spaceId,
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
        getPostPreviewCommentAuthors(context, item.spaceId, item.commentsSummary),
    ]);

    return new PostModel({
        id: item.postId,
        spaceId: item.spaceId,
        channelId: item.channelId,
        createdTime: item.createdTime,
        author,
        content: item.content,
        totalCommentCount: getTotalPostCommentCount(item.commentsSummary),
        totalCommentAuthorCount: item.commentsSummary.commentCountByAuthorId.size,
        previewCommentAuthors,
    });
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
 * Create a new root comment on the post.
 */
export function createPostRootComment(
    context: RequestContext,
    {
        postId,
        content,
    }: {
        postId: PostId;
        content: PostCommentContent;
    },
) {
    return createPostRootOrReplyComment(context, {postId, content});
}

/**
 * Create a new comment replying to a root comment.
 */
export function createPostReplyComment(
    context: RequestContext,
    {
        postId,
        rootCommentNumber,
        content,
    }: {
        postId: PostId;
        rootCommentNumber: number;
        content: PostCommentContent;
    },
) {
    return createPostRootOrReplyComment(context, {
        postId,
        content,
        replyToRootCommentNumber: rootCommentNumber,
    });
}

function createPostRootOrReplyComment(
    context: RequestContext,
    {
        postId,
        content,
        replyToRootCommentNumber,
    }: {
        postId: PostId;
        content: PostCommentContent;

        /**
         * Is this comment a reply to a root comment? If so this will be set to the
         * number of the root comment we are replying to.
         */
        replyToRootCommentNumber?: number;
    },
): Promise<void> {
    return retryDynamoConditionCheckErrors(async () => {
        const [postItem, replyToRootCommentItem] = await runAllPromiseThunks(
            async () => {
                const postItem = await PostsTable.getPartialItem(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "Attributes",
                        postId,
                    },
                    {
                        attributes: ["channelId", "commentsSummary", "updateLockVersion"],
                    },
                );
                if (!postItem) throw new NotFoundError("Can not find post");

                // Make sure we have access to the channel and (implicitly) the space the
                // channel is in.
                await authorizeChannelAccess(context, postItem.channelId);

                return postItem;
            },
            async () => {
                if (typeof replyToRootCommentNumber !== "number") return null;

                const replyToRootCommentItem = await PostsTable.getPartialItem(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "RootComments",
                        postId,
                        rootCommentNumber: replyToRootCommentNumber,
                    },
                    {
                        attributes: ["replyCommentsSummary", "updateLockVersion"],
                    },
                );
                if (!replyToRootCommentItem)
                    throw new NotFoundError("Can not find comment to reply to");

                return replyToRootCommentItem;
            },
        );

        const transactionEntries: Array<DynamoTransactionEntry> = [];
        const createdTime = new Date();

        if (!replyToRootCommentItem) {
            transactionEntries.push(
                PostsTable.transactionCreateItem({
                    partitionType: "Post",
                    sortRangeType: "RootComments",
                    postId,
                    // Consume the next number. We need to make sure to increment
                    // `sequenceNumber` on `postItem`. See the transaction entries below.
                    rootCommentNumber: postItem.commentsSummary.sequenceNumber + 1,
                    createdTime,
                    isDeletedButHasReplies: false,
                    authorId: context.auth.getAccountId(),
                    content,
                    replyCommentsSummary: emptyPostCommentsSummary,
                }),
            );
        } else {
            transactionEntries.push(
                PostsTable.transactionCreateItem({
                    partitionType: "Post",
                    sortRangeType: "ReplyComments",
                    postId,
                    rootCommentNumber: replyToRootCommentItem.rootCommentNumber,
                    // Consume the next number. We need to make sure to increment
                    // `sequenceNumber` on `replyToRootCommentItem`. See the transaction entries
                    // below.
                    replyCommentNumber:
                        replyToRootCommentItem.replyCommentsSummary.sequenceNumber + 1,
                    createdTime,
                    authorId: context.auth.getAccountId(),
                    content,
                }),
            );
        }

        transactionEntries.push(
            PostsTable.transactionDirectlyUpdateItemAttribute(
                {
                    partitionType: "Post",
                    sortRangeType: "Attributes",
                    postId,
                },
                "commentsSummary",
                !replyToRootCommentItem
                    ? incrementPostCommentCount(
                          postItem.commentsSummary,
                          context.auth.getAccountId(),
                      )
                    : // Don't increment the post item sequence number if we are adding a reply. We
                      // want to update the reply comment sequence number.
                      incrementPostCommentCountWithoutIncrementingSequenceNumber(
                          postItem.commentsSummary,
                          context.auth.getAccountId(),
                      ),
                {updateLockVersion: postItem.updateLockVersion},
            ),
        );

        if (replyToRootCommentItem) {
            transactionEntries.push(
                PostsTable.transactionDirectlyUpdateItemAttribute(
                    {
                        partitionType: "Post",
                        sortRangeType: "RootComments",
                        postId,
                        rootCommentNumber: replyToRootCommentItem.rootCommentNumber,
                    },
                    "replyCommentsSummary",
                    incrementPostCommentCount(
                        replyToRootCommentItem.replyCommentsSummary,
                        context.auth.getAccountId(),
                    ),
                    {updateLockVersion: replyToRootCommentItem.updateLockVersion},
                ),
            );
        }

        await DynamoTableSchema.executeTransaction(context, transactionEntries);
    });
}

/**
 * Delete a post root comment.
 *
 * You may not delete a comment that you did not author. An error will be
 * thrown if you try.
 */
export function deletePostRootComment(
    context: RequestContext,
    {postId, rootCommentNumber}: {postId: PostId; rootCommentNumber: number},
): Promise<void> {
    return retryDynamoConditionCheckErrors(async () => {
        const [postItem, rootCommentItem] = await runAllPromiseThunks(
            async () => {
                const postItem = await PostsTable.getPartialItem(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "Attributes",
                        postId,
                    },
                    {
                        attributes: ["channelId", "commentsSummary", "updateLockVersion"],
                    },
                );
                if (!postItem) throw new NotFoundError("Can not find post");

                // Make sure we have access to the channel and (implicitly) the space the
                // channel is in.
                await authorizeChannelAccess(context, postItem.channelId);

                return postItem;
            },
            async () => {
                const rootCommentItem = await PostsTable.getPartialItem(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "RootComments",
                        postId,
                        rootCommentNumber,
                    },
                    {
                        attributes: [
                            "isDeletedButHasReplies",
                            "authorId",
                            "replyCommentsSummary",
                            "updateLockVersion",
                        ],
                    },
                );
                if (!rootCommentItem) throw new NotFoundError("Can not find root comment");

                if (rootCommentItem.isDeletedButHasReplies)
                    throw new FailedPreconditionError(
                        "Can not delete a gravestone comment a second time",
                    );

                return rootCommentItem;
            },
        );

        const transactionEntries: Array<DynamoTransactionEntry> = [];

        if (rootCommentItem.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can not delete another account's comment");

        // 1. Delete the root comment item

        // If this root comment has some replies then don't delete the root comment.
        // Instead, mark `isDeletedButHasReplies` as true. You are not allowed to delete
        // comments from other accounts. Deleting a comment with replies would "remove"
        // the threaded reply comments which you're not allowed to do. So we leave a
        // gravestone in place.
        if (getTotalPostCommentCount(rootCommentItem.replyCommentsSummary) > 0) {
            transactionEntries.push(
                PostsTable.transactionDirectlyUpdateItemAttribute(
                    {
                        partitionType: "Post",
                        sortRangeType: "RootComments",
                        postId,
                        rootCommentNumber,
                    },
                    "isDeletedButHasReplies",
                    true,
                    {updateLockVersion: rootCommentItem.updateLockVersion},
                ),
            );
        } else {
            transactionEntries.push(
                PostsTable.transactionDeleteItem({
                    partitionType: "Post",
                    sortRangeType: "RootComments",
                    postId,
                    rootCommentNumber,
                }),
            );
        }

        // 2. Decrement the post comment count
        transactionEntries.push(
            PostsTable.transactionDirectlyUpdateItemAttribute(
                {
                    partitionType: "Post",
                    sortRangeType: "Attributes",
                    postId,
                },
                "commentsSummary",
                decrementPostCommentCount(postItem.commentsSummary, rootCommentItem.authorId),
                {updateLockVersion: postItem.updateLockVersion},
            ),
        );

        await DynamoTableSchema.executeTransaction(context, transactionEntries);
    });
}

/**
 * Delete a post reply comment.
 *
 * You may not delete a comment that you did not author. An error will be
 * thrown if you try.
 */
export function deletePostReplyComment(
    context: RequestContext,
    {
        postId,
        rootCommentNumber,
        replyCommentNumber,
    }: {postId: PostId; rootCommentNumber: number; replyCommentNumber: number},
): Promise<void> {
    return retryDynamoConditionCheckErrors(async () => {
        const [postItem, rootCommentItem, replyCommentItem] = await runAllPromiseThunks(
            async () => {
                const postItem = await PostsTable.getPartialItem(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "Attributes",
                        postId,
                    },
                    {
                        attributes: ["channelId", "commentsSummary", "updateLockVersion"],
                    },
                );
                if (!postItem) throw new NotFoundError("Can not find post");

                // Make sure we have access to the channel and (implicitly) the space the
                // channel is in.
                await authorizeChannelAccess(context, postItem.channelId);

                return postItem;
            },
            async () => {
                const rootCommentItem = await PostsTable.getPartialItem(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "RootComments",
                        postId,
                        rootCommentNumber,
                    },
                    {
                        attributes: [
                            "isDeletedButHasReplies",
                            "authorId",
                            "replyCommentsSummary",
                            "updateLockVersion",
                        ],
                    },
                );
                if (!rootCommentItem) throw new NotFoundError("Can not find root comment");

                return rootCommentItem;
            },
            async () => {
                const replyCommentItem = await PostsTable.getPartialItem(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "ReplyComments",
                        postId,
                        rootCommentNumber,
                        replyCommentNumber,
                    },
                    {
                        attributes: ["authorId"],
                    },
                );
                if (!replyCommentItem) throw new NotFoundError("Can not find reply comment");

                return replyCommentItem;
            },
        );

        const transactionEntries: Array<DynamoTransactionEntry> = [];

        if (replyCommentItem.authorId !== context.auth.getAccountId())
            throw new PermissionDeniedError("Can not delete another account's comment");

        // 1. Delete the reply comment item
        transactionEntries.push(
            PostsTable.transactionDeleteItem({
                partitionType: "Post",
                sortRangeType: "ReplyComments",
                postId,
                rootCommentNumber,
                replyCommentNumber: replyCommentItem.replyCommentNumber,
            }),
        );

        // 2. Decrement the post comment count
        transactionEntries.push(
            PostsTable.transactionDirectlyUpdateItemAttribute(
                {
                    partitionType: "Post",
                    sortRangeType: "Attributes",
                    postId,
                },
                "commentsSummary",
                decrementPostCommentCount(postItem.commentsSummary, replyCommentItem.authorId),
                {updateLockVersion: postItem.updateLockVersion},
            ),
        );

        // 3. Decrement the root comment reply count
        //
        // The transaction entry is actually added below. We need to see if we're
        // deleting a gravestone root comment first.
        const newReplyCommentsSummary = decrementPostCommentCount(
            rootCommentItem.replyCommentsSummary,
            replyCommentItem.authorId,
        );

        // 4. Cleanup gravestone root comments
        let isDeletingRootComment = false;

        // If we are deleting the last reply on a gravestone root comment then also
        // delete the gravestone root comment so the gravestone doesn't sit around
        // forever awkwardly.
        if (
            getTotalPostCommentCount(newReplyCommentsSummary) === 0 &&
            rootCommentItem.isDeletedButHasReplies
        ) {
            transactionEntries.push(
                PostsTable.transactionDeleteItem({
                    partitionType: "Post",
                    sortRangeType: "RootComments",
                    postId,
                    rootCommentNumber,
                }),
            );
            isDeletingRootComment = true;
        }

        // Only update the reply comments summary if we aren't deleting the root
        // comment. DynamoDB doesn't let us change the same item twice in one
        // transaction.
        if (!isDeletingRootComment) {
            transactionEntries.push(
                PostsTable.transactionDirectlyUpdateItemAttribute(
                    {
                        partitionType: "Post",
                        sortRangeType: "RootComments",
                        postId,
                        rootCommentNumber: rootCommentItem.rootCommentNumber,
                    },
                    "replyCommentsSummary",
                    newReplyCommentsSummary,
                    {updateLockVersion: rootCommentItem.updateLockVersion},
                ),
            );
        }

        await DynamoTableSchema.executeTransaction(context, transactionEntries);
    });
}

function getTotalPostCommentCount(commentsSummary: PostCommentsSummary): number {
    let totalCommentCount = 0;

    for (const commentCount of commentsSummary.commentCountByAuthorId.values())
        totalCommentCount += commentCount;

    return totalCommentCount;
}

const postPreviewCommentAuthorsMaxLength = 5;

function getPostPreviewCommentAuthors(
    context: RequestContext,
    spaceId: SpaceId,
    commentsSummary: PostCommentsSummary,
): Promise<ReadonlyArray<AccountModel>> {
    const previewCommentAuthorPromises: Array<Promise<AccountModel>> = [];

    for (const authorId of commentsSummary.commentCountByAuthorId.keys()) {
        // Don't grow past our max comment author length.
        if (previewCommentAuthorPromises.length >= postPreviewCommentAuthorsMaxLength) break;

        previewCommentAuthorPromises.push(getAccountOrThrow(context, spaceId, authorId));
    }

    return runAllPromises(previewCommentAuthorPromises);
}

/**
 * Increment the comment count by 1 for the provided `accountId`.
 */
function incrementPostCommentCount(
    commentCount: PostCommentsSummary,
    authorId: AccountId,
): PostCommentsSummary {
    commentCount = {...commentCount, sequenceNumber: commentCount.sequenceNumber + 1};
    return incrementPostCommentCountWithoutIncrementingSequenceNumber(commentCount, authorId);
}

/**
 * Increment the comment count by 1 for the provided `accountId`.
 *
 * Does not update the `sequenceNumber`!
 */
function incrementPostCommentCountWithoutIncrementingSequenceNumber(
    commentCount: PostCommentsSummary,
    authorId: AccountId,
): PostCommentsSummary {
    const commentCountByAuthorId = new Map(commentCount.commentCountByAuthorId);

    const previousCommentCount = commentCount.commentCountByAuthorId.get(authorId) ?? 0;
    commentCountByAuthorId.set(authorId, previousCommentCount + 1);

    return {
        ...commentCount,
        commentCountByAuthorId,
    };
}

/**
 * Decrement the comment count by 1 for the provided `accountId`.
 *
 * Does not decrement the `sequenceNumber`. We never decrement the
 * `sequenceNumber`. If we did we run the risk of creating comments with
 * conflicting numbers.
 */
function decrementPostCommentCount(
    commentCount: PostCommentsSummary,
    authorId: AccountId,
): PostCommentsSummary {
    const previousCommentCount = commentCount.commentCountByAuthorId.get(authorId);
    if (previousCommentCount === undefined)
        throw new InternalError(
            "Can not decrement comment count for account which does not appear in the comment count map",
        );
    if (previousCommentCount <= 0)
        throw new InternalError(
            "Can not decrement comment count for account with a comment count of zero",
        );

    const commentCountByAuthorId = new Map(commentCount.commentCountByAuthorId);

    // If the account has deleted all their comments, then remove them from the
    // map entirely.
    if (previousCommentCount === 1) {
        commentCountByAuthorId.delete(authorId);
    } else {
        commentCountByAuthorId.set(authorId, previousCommentCount - 1);
    }

    return {...commentCount, commentCountByAuthorId};
}

/**
 * Paginate through a post's root comments. Uses cursor based pagination.
 */
export async function getPostRootComments(
    context: RequestContext,
    {
        postId,
        afterRootCommentNumber,
        limit,
    }: {postId: PostId; afterRootCommentNumber?: number; limit: number},
): Promise<ReadonlyArray<PostRootCommentModel>> {
    const {spaceId} = await authorizePostAccess(context, postId);

    const rootCommentPromises: Array<Promise<PostRootCommentModel>> = [];

    for await (const rootCommentItem of PostsTable.query(context, {
        startKey: {
            partitionType: "Post",
            sortRangeType: "RootComments",
            postId,
            rootCommentNumber: (afterRootCommentNumber ?? -1) + 1,
        },
        endKey: {
            partitionType: "Post",
            sortRangeType: "RootComments",
            postId,
            rootCommentNumber: Number.MAX_SAFE_INTEGER,
        },
        limit,
    })) {
        rootCommentPromises.push(
            createPostRootCommentModelFromItem(context, spaceId, rootCommentItem),
        );
    }

    return runAllPromises(rootCommentPromises);
}

async function createPostRootCommentModelFromItem(
    context: RequestContext,
    spaceId: SpaceId,
    item: PostRootCommentItem,
): Promise<PostRootCommentModel> {
    const [author, previewReplyComments, previewReplyCommentAuthors] = await runAllPromises([
        getAccountOrThrow(context, spaceId, item.authorId),
        getPostPreviewReplyComments(context, spaceId, item),
        getPostPreviewCommentAuthors(context, spaceId, item.replyCommentsSummary),
    ]);

    return new PostRootCommentModel({
        postId: item.postId,
        rootCommentNumber: item.rootCommentNumber,
        createdTime: item.createdTime,
        author,
        // Null out content if the root comment is deleted. Don't let the client see
        // the content. The client will check if `content` is `null` for showing a
        // gravestone.
        content: item.isDeletedButHasReplies ? null : item.content,
        totalReplyCommentCount: getTotalPostCommentCount(item.replyCommentsSummary),
        previewReplyComments,
        totalReplyCommentAuthorCount: item.replyCommentsSummary.commentCountByAuthorId.size,
        previewReplyCommentAuthors,
    });
}

/**
 * Get some small number of reply comments to preview beneath a root comment
 * with a "show more" button afterwards.
 */
async function getPostPreviewReplyComments(
    context: RequestContext,
    spaceId: SpaceId,
    rootCommentItem: PostRootCommentItem,
): Promise<Array<PostReplyCommentModel>> {
    // Optimization: If there are no reply comments, don't bother querying.
    if (getTotalPostCommentCount(rootCommentItem.replyCommentsSummary) === 0) return [];

    const itemIterator = PostsTable.query(context, {
        startKey: {
            partitionType: "Post",
            sortRangeType: "ReplyComments",
            postId: rootCommentItem.postId,
            rootCommentNumber: rootCommentItem.rootCommentNumber,
            replyCommentNumber: 0,
        },
        endKey: {
            partitionType: "Post",
            sortRangeType: "ReplyComments",
            postId: rootCommentItem.postId,
            rootCommentNumber: rootCommentItem.rootCommentNumber,
            replyCommentNumber: Number.MAX_SAFE_INTEGER,
        },
        limit: 3,
    });

    return parallelMapAsyncIterableToArray(itemIterator, item =>
        createPostReplyCommentModelFromItem(context, spaceId, item),
    );
}

async function createPostReplyCommentModelFromItem(
    context: RequestContext,
    spaceId: SpaceId,
    item: PostReplyCommentItem,
): Promise<PostReplyCommentModel> {
    return new PostReplyCommentModel({
        postId: item.postId,
        rootCommentNumber: item.rootCommentNumber,
        replyCommentNumber: item.replyCommentNumber,
        createdTime: item.createdTime,
        author: await getAccountOrThrow(context, spaceId, item.authorId),
        content: item.content,
    });
}

/**
 * Get a post and some of the root comments on the post at the same time. More
 * efficient than calling `getPost()` and `getPostRootComments()` separately.
 */
export async function getPostWithRootComments(
    context: RequestContext,
    {postId, rootCommentLimit}: {postId: PostId; rootCommentLimit: number},
): Promise<{
    post: PostModel;
    rootComments: ReadonlyArray<PostRootCommentModel>;
} | null> {
    let iterationState: {
        postItem: PostAttributesItem;
        postPromise: Promise<PostModel>;
        rootCommentPromises: Array<Promise<PostRootCommentModel>>;
    } | null = null;

    for await (const item of PostsTable.query(context, {
        startKey: {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        endKey: {
            partitionType: "Post",
            sortRangeType: "RootComments",
            postId,
            rootCommentNumber: Number.MAX_SAFE_INTEGER,
        },
        limit: rootCommentLimit + 1,
    })) {
        switch (item.sortRangeType) {
            case "Attributes": {
                assert(iterationState === null);

                const postPromise = createPostModelFromItem(context, item);

                // Ignore unhandled errors. In case something else throws an error before we
                // can await this.
                postPromise.catch(() => {});

                iterationState = {
                    postItem: item,
                    postPromise,
                    rootCommentPromises: [],
                };

                await authorizeChannelAccess(context, item.channelId);
                break;
            }
            case "RootComments": {
                if (iterationState === null)
                    throw new DataLossError("Post has root comments but not attributes");

                const {postItem, rootCommentPromises} = iterationState;

                const rootCommentPromise = createPostRootCommentModelFromItem(
                    context,
                    postItem.spaceId,
                    item,
                );

                // Ignore unhandled errors. In case something else throws an error before we
                // can await this.
                rootCommentPromise.catch(() => {});

                rootCommentPromises.push(rootCommentPromise);
                break;
            }
            default:
                throw exhaustive(item);
        }
    }

    // If we never found a post then return null.
    if (iterationState === null) return null;
    const {postPromise, rootCommentPromises} = iterationState;

    const [post, rootComments] = await runAllPromises([
        postPromise,
        runAllPromises(rootCommentPromises),
    ]);

    return {post, rootComments};
}

/**
 * Paginate through a root comment's reply comments. Uses cursor based pagination.
 */
export async function getPostReplyComments(
    context: RequestContext,
    {
        postId,
        rootCommentNumber,
        afterReplyCommentNumber,
        limit,
    }: {
        postId: PostId;
        rootCommentNumber: number;
        afterReplyCommentNumber?: number;
        limit: number;
    },
): Promise<ReadonlyArray<PostReplyCommentModel>> {
    const {spaceId} = await authorizePostAccess(context, postId);

    const itemIterator = PostsTable.query(context, {
        startKey: {
            partitionType: "Post",
            sortRangeType: "ReplyComments",
            postId,
            rootCommentNumber,
            replyCommentNumber: (afterReplyCommentNumber ?? -1) + 1,
        },
        endKey: {
            partitionType: "Post",
            sortRangeType: "ReplyComments",
            postId,
            rootCommentNumber,
            replyCommentNumber: Number.MAX_SAFE_INTEGER,
        },
        limit,
    });

    return parallelMapAsyncIterableToArray(itemIterator, item =>
        createPostReplyCommentModelFromItem(context, spaceId, item),
    );
}
