import {addSeconds} from "date-fns";
import {getMessageContentReferencesForNode} from "~/server/content/get_content_references.js";
import {
    applyMentionCountByAccountIdDifferenceFromContentUpdate,
    getMentionedAccountIdsInContent,
} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
    ServerBotActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {getFileFromAttachment} from "~/server/files/data/files_actions.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {authorizePostAccess} from "~/server/forum/data/authorize_post_access.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {
    ForumRealtimeTable,
    PostAttributesItem,
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ForumTable} from "~/server/forum/data/internal/forum_table.js";
import {
    PostItemAuthorizationCache,
    getPostItemWithContentForAuthorization,
} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {maxChannelContributionCount} from "~/server/forum/data/max_channel_contribution_count.js";
import {createMessagePayloadModel} from "~/server/messaging/helpers/create_message_payload_model.js";
import {getMessageChangeLogExpirationTimeFromChangeTime} from "~/server/messaging/helpers/get_message_change_log_expiration_time_from_change_time.js";
import {messageStreamIndexSearchEntityDelaySeconds} from "~/server/messaging/helpers/message_stream_index_search_entity_delay_seconds.js";
import {processCommentsQuery} from "~/server/messaging/helpers/process_comments_query.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {getNotificationMessageContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {getAccount, isAccountMemberOfSpace} from "~/server/spaces/spaces_actions.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {
    FailedPreconditionError,
    InternalError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {
    createPostCommentNotFoundError,
    createPostNotFoundError,
} from "~/shared/forum/forum_error_messages.js";
import {PostCommentModel, PostModel} from "~/shared/forum/post_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {reduceIterable} from "~/shared/helpers/iterable/reduce_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, ChannelId, FileId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageChange, getMessageChangeTime} from "~/shared/messaging/message_change_schema.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";

/**
 * Add a new comment to a post.
 */
export async function createPostComment(
    context: ServerAccountActionContext,
    {
        postId,
        parentCommentIndex,
        content,
        fileIds,
        isStream,
        consistency = "Eventual",
    }: {
        postId: PostId;
        parentCommentIndex: number | null;
        content: MessageContent;
        fileIds: ReadonlyArray<FileId | FileEntityId>;
        isStream?: boolean;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    index: number;
    createdTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
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
                    "authorId",
                    "commentsSummary",
                    "updateLockVersion",
                ],
            },
        );

        // After we've loaded a post, save it to the authorization cache so if we need
        // to authorize later in the action it's available.
        PostItemAuthorizationCache.set(context, consistency, postId, postItemPromise);

        const [postItem] = await runAllPromises([
            postItemPromise.then(async postItem => {
                if (!postItem) throw createPostNotFoundError(postId);

                await runAllPromises([
                    authorizeChannelAccess(context, postItem.channelId, "Comment", {consistency}),

                    // Make sure all the provided files exist.
                    runAllPromises(
                        fileIds.map(fileId =>
                            isId<FileId>(fileId)
                                ? getFileFromAttachment(
                                      context,
                                      postItem.spaceId,
                                      fileId,
                                      FilePostAuthorizer.bind({type: "PostComments", postId}),
                                      {consistency},
                                  )
                                : null,
                        ),
                    ),
                ]);

                return postItem;
            }),

            (async () => {
                if (typeof parentCommentIndex !== "number") return;

                const parentCommentItem = await ForumTable.getPartialItemIfExists(
                    context,
                    {
                        partitionType: "Post",
                        sortRangeType: "Comments",
                        postId,
                        commentIndex: parentCommentIndex,
                    },
                    {
                        consistency,
                        attributes: [],
                    },
                );
                if (!parentCommentItem) throw new NotFoundError("Post parent comment not found");
            })(),
        ]);

        const commentIndex = postItem.commentsSummary.nextCommentIndex;
        const createdTime = new Date();
        const authorId = context.actor.getPossiblyBotAccountId();

        if (isStream && context.actor.type !== "Bot") {
            throw new PermissionDeniedError("Only bots can send `Stream` messages");
        }

        const newCommentCountByAuthorId = new Map(postItem.commentsSummary.commentCountByAuthorId);
        const oldCommentCount = postItem.commentsSummary.commentCountByAuthorId.get(authorId) ?? 0;
        newCommentCountByAuthorId.set(authorId, oldCommentCount + 1);

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            postItem.commentsSummary.mentionCountByAccountId,
            null,
            content,
        );

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
                    fileIds,
                    clerical: isStream ? {type: "Stream"} : undefined,
                },
            }),

            // Ok for us to not tell the client about a comment summary update through our
            // general realtime system. Instead, comment counts will be updated through the
            // messaging realtime system.
            ForumRealtimeTable.transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentIndex: postItem.commentsSummary.nextCommentIndex + 1,
                    lastChangeTime: postItem.commentsSummary.lastChangeTime,
                    commentCountByAuthorId: newCommentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: postItem.updateLockVersion},
            ),

            // If this is a stream comment then create the stream state item.
            // Create-or-replace is safe since we know the comment index doesn't exist from
            // our other condition checks.
            ...(isStream
                ? [
                      ForumTable.transactionCreateOrReplaceItem({
                          partitionType: "Post",
                          sortRangeType: "Comments#Stream",
                          postId,
                          commentIndex,
                          authorId,
                          completedTime: null,
                          partCount: 0,
                          lastPartUpdateLockVersion: null,
                          lastIndexSearchEntityJob: {
                              sendTime: createdTime,
                              delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
                          },
                      }),
                  ]
                : []),
        ]);

        // When the account comments on a post they didn't author for the first time,
        // update the contributors map. It's ok to do this in
        // `context.process.waitUntil()`. It's fine if `AppService` crashes and we
        // don't record the contribution.
        if (postItem.authorId !== authorId && oldCommentCount === 0) {
            context.process.waitUntil(async () => {
                let oldContributionCount = 0;
                let newContributionCount = 0;

                await ForumRealtimeTable.updateItem(
                    // This update happens asynchronously in the background. So we don't need strong
                    // read consistency here if the context was expecting it.
                    context.dynamo.unexpectStrongReadConsistency(),
                    {
                        partitionType: "Channel",
                        sortRangeType: "Contributors",
                        channelId: postItem.channelId,
                    },
                    contributorsItem => {
                        contributorsItem ??= {
                            partitionType: "Channel",
                            sortRangeType: "Contributors",
                            channelId: postItem.channelId,
                            spaceId: postItem.spaceId,
                            contributionCountByAccountId: new Map(),
                            accountIdsWithGrant: emptyArray,
                        };

                        oldContributionCount =
                            contributorsItem.contributionCountByAccountId.get(authorId) ?? 0;

                        newContributionCount = Math.min(
                            oldContributionCount + 1,
                            maxChannelContributionCount,
                        );

                        // If this account has already reached the max contribution count then don't
                        // increment their contributions anymore.
                        if (oldContributionCount === newContributionCount) {
                            return contributorsItem;
                        }

                        const newContributionCountByAccountId = new Map(
                            contributorsItem.contributionCountByAccountId,
                        );

                        newContributionCountByAccountId.set(authorId, newContributionCount);

                        return {
                            ...contributorsItem,
                            contributionCountByAccountId: newContributionCountByAccountId,
                        };
                    },
                );

                // Reindex the channel whenever someone contributes for the first time
                // (making them a minor contributor) or when someone maxes out their
                // contribution count (making them a major contributor).
                if (
                    oldContributionCount !== newContributionCount &&
                    (oldContributionCount === 0 ||
                        newContributionCount === maxChannelContributionCount)
                ) {
                    context.jobs.send({
                        type: "IndexSearchEntity",
                        spaceId: postItem.spaceId,
                        update: {
                            type: "Channel",
                            channelId: postItem.channelId,
                            updatedTraits: {type: "Some", traits: []},
                        },
                    });
                }
            });
        }

        const mentionedAccountIds = getMentionedAccountIdsInContent(content);
        const contentSnippet = getNotificationMessageContentSnippet(content);

        context.jobs.send({
            type: "NotificationEvent",
            event: {
                type: "CreatePostComment",
                id: generateChronologicalId(),
                spaceId: postItem.spaceId,
                postId,
                commentIndex,
                createdTime,
                authorId,
                mentionedAccountIds,
                isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
                contentSnippet,
            },
        });

        context.jobs.send(
            {
                type: "IndexSearchEntity",
                spaceId: postItem.spaceId,
                update: {
                    type: "PostComment",
                    postId,
                    commentIndex,
                    // Nothing depends on this entity when it's created. Don't bother trying to
                    // reindex dependencies.
                    updatedTraits: {type: "None"},
                },
            },
            {delaySeconds: isStream ? messageStreamIndexSearchEntityDelaySeconds : 0},
        );

        // Only increase affinity score if we have a session actor. Don't increase
        // affinity score if this is a system actor sending a message on behalf of an
        // account.
        if (context.actor.type === "Session") {
            const sessionContext = context.actor.authorizeSession();

            // Creating a comment on a post accrues affinity points to the channel the post
            // was made in. If you're interacting with a post this probably means the topic
            // of the post (the channel) is relevant to you as well.
            //
            // We don't give posts themselves affinity points. That's because posts are
            // fairly short lived (a couple days). However, we give channels affinity
            // points so you could quickly jump to a channel if you're looking for a
            // certain post inside the channel.
            context.process.waitUntil(
                markSearchAffinityEntityInteraction(sessionContext, {
                    spaceId: postItem.spaceId,
                    entityId: `Channel:${postItem.channelId}`,
                    interaction:
                        content.nodeSize < 50
                            ? {type: "LowIntentUpdate"}
                            : {type: "MediumIntentUpdate"},
                }),
            );

            // Increase affinity points for all mentioned accounts with a high intent
            // update since the user clearly wants the attention of the mentioned accounts.
            //
            // (If a mentioned account doesn't have access to this message should that
            // still be a high intent update? For now we say yes since the user is
            // explicitly choosing to reference them.)
            for (const mentionedAccountId of mentionedAccountIds) {
                context.process.waitUntil(async () => {
                    if (
                        await isAccountMemberOfSpace(context, postItem.spaceId, mentionedAccountId)
                    ) {
                        await markSearchAffinityEntityInteraction(sessionContext, {
                            spaceId: postItem.spaceId,
                            entityId: `Account:${mentionedAccountId}`,
                            interaction: {type: "HighIntentUpdate"},
                        });
                    }
                });
            }
        }

        return {
            spaceId: postItem.spaceId,
            index: commentIndex,
            createdTime,
        };
    });
}

/**
 * Update a part of the comment stream.
 *
 * Comment streams are made up of multiple parts. Only the bot that created a
 * stream can update the stream. A bot can only create new parts or update the
 * last part of the stream.
 *
 * Currently, you completely replace a part when you update it. We may allow
 * more granular part updates in the future.
 */
export function putPostCommentStreamPart(
    context: ServerBotActionContext,
    {
        postId,
        commentIndex,
        partIndex,
        payload,
        consistency,
    }: {
        postId: PostId;
        commentIndex: number;
        partIndex: number;
        payload: MessageStreamPartPayload;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    version: number;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizePostAccess(context, postId, "Comment", {consistency}),

            ForumTable.getItemIfExists(
                context,
                {
                    partitionType: "Post",
                    sortRangeType: "Comments#Stream",
                    postId,
                    commentIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn’t a stream", {
                displayMessage: errorDisplayMessage`Message isn’t a stream.`,
            });
        }

        if (item.authorId !== context.actor.getBotAccountId()) {
            throw new PermissionDeniedError("Only the bot who created the stream can update it", {
                displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
            });
        }

        if (item.completedTime !== null) {
            throw new FailedPreconditionError("The stream has already been completed", {
                displayMessage: errorDisplayMessage`The stream has already been completed.`,
            });
        }

        // Use `Date.now()` so tests can mock the `Date.now()` function.
        const currentTime = new Date(Date.now());

        let nextIndexSearchEntityJob: {sendTime: Date; delaySeconds: number} | null = null;

        if (
            isDatePossiblyLessThanWithUncertaintyWindow(
                addSeconds(
                    item.lastIndexSearchEntityJob.sendTime,
                    item.lastIndexSearchEntityJob.delaySeconds,
                ),
                currentTime,
            )
        ) {
            nextIndexSearchEntityJob = {
                sendTime: currentTime,
                delaySeconds: messageStreamIndexSearchEntityDelaySeconds,
            };
        }

        let version: number;

        if (partIndex === item.partCount) {
            const createPartTransactionEntry = ForumTable.transactionCreateOrReplaceItem({
                partitionType: "Post",
                sortRangeType: "Comments#StreamPart",
                postId,
                commentIndex,
                partIndex,
                payload,
                // `updateLockVersion: 0` is always represented as `undefined`.
                updateLockVersion: undefined,
            });

            version = createPartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                ForumTable.transactionDirectlyUpdateItem({
                    ...item,
                    partCount: partIndex + 1,
                    lastPartUpdateLockVersion: 0,
                    lastIndexSearchEntityJob:
                        nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
                }),
                createPartTransactionEntry,
            ]);
        } else {
            if (partIndex !== item.partCount - 1) {
                throw new FailedPreconditionError(
                    "Only the last part of the stream or the next part can be updated",
                    {
                        displayMessage: errorDisplayMessage`Only the last part of the stream (index ${
                            item.partCount - 1
                        }) or the next part (index ${item.partCount}) can be updated.`,
                    },
                );
            }

            assert(item.lastPartUpdateLockVersion !== null);

            const updatePartTransactionEntry = ForumTable.transactionCreateOrReplaceItem({
                partitionType: "Post",
                sortRangeType: "Comments#StreamPart",
                postId,
                commentIndex,
                partIndex,
                payload,
                updateLockVersion: item.lastPartUpdateLockVersion + 1,
            });

            version = updatePartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                ForumTable.transactionDirectlyUpdateItem({
                    ...item,
                    lastPartUpdateLockVersion: item.lastPartUpdateLockVersion + 1,
                    lastIndexSearchEntityJob:
                        nextIndexSearchEntityJob ?? item.lastIndexSearchEntityJob,
                }),
                updatePartTransactionEntry,
            ]);
        }

        if (nextIndexSearchEntityJob) {
            context.jobs.send(
                {
                    type: "IndexSearchEntity",
                    spaceId,
                    update: {
                        type: "PostComment",
                        postId,
                        commentIndex,
                        updatedTraits: {type: "Some", traits: []},
                    },
                },
                {delaySeconds: nextIndexSearchEntityJob.delaySeconds},
            );
        }

        return {spaceId, version};
    });
}

/**
 * Completes a comment stream. After this parts can't be added or updated.
 *
 * This function is idempotent. If the stream is already completed this method
 * does nothing.
 */
export function completePostCommentStream(
    context: ServerBotActionContext,
    {
        postId,
        commentIndex,
        consistency,
    }: {
        postId: PostId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    completedTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [{spaceId}, item] = await runAllPromises([
            // Make sure the bot has access (and wasn't removed from the space).
            authorizePostAccess(context, postId, "Comment", {consistency}),

            ForumTable.getItemIfExists(
                context,
                {
                    partitionType: "Post",
                    sortRangeType: "Comments#Stream",
                    postId,
                    commentIndex,
                },
                {consistency},
            ),
        ]);

        if (!item) {
            throw new FailedPreconditionError("Message isn’t a stream", {
                displayMessage: errorDisplayMessage`Message isn’t a stream.`,
            });
        }

        if (item.authorId !== context.actor.getBotAccountId()) {
            throw new PermissionDeniedError("Only the bot who created the stream can update it", {
                displayMessage: errorDisplayMessage`Only the bot who created the stream can update it.`,
            });
        }

        // Already completed!
        if (item.completedTime !== null) {
            return {spaceId, completedTime: item.completedTime};
        }

        const completedTime = new Date();

        await ForumTable.directlyUpdateItem(context, {
            ...item,
            completedTime,
        });

        return {spaceId, completedTime};
    });
}

async function getPostCommentItemIfExists(
    context: ServerActionContext,
    postId: PostId,
    commentIndex: number,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<MessageItem | null> {
    const items = await arrayFromAsyncIterable(
        processCommentsQuery(
            "Ascending",
            ForumTable.query(context, {
                limit: "All",
                consistency,
                partitionKey: {
                    partitionType: "Post",
                    postId,
                },
                startSortKey: {
                    sortRangeType: "Comments",
                    commentIndex,
                },
                endSortKey: {
                    sortRangeType: "Comments#StreamPart",
                    commentIndex,
                    partIndex: Number.MAX_SAFE_INTEGER,
                },
            }),
        ),
    );

    assert(items.length <= 1);

    return items[0] ?? null;
}

/**
 * Get a single post comment.
 */
export async function getPostComment(
    context: ServerActionContext,
    {postId, commentIndex}: {postId: PostId; commentIndex: number},
): Promise<PostCommentModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizePostAccess(context, postId, "View"),
        getPostCommentItemIfExists(context, postId, commentIndex),
    ]);

    if (!item) throw createPostCommentNotFoundError(postId, commentIndex);

    return createPostCommentModelFromItem(context, spaceId, postId, item);
}

/**
 * Get a single post comment's payload.
 */
export async function getPostCommentPayload(
    context: ServerActionContext,
    {
        postId,
        commentIndex,
        consistency = "Eventual",
    }: {
        postId: PostId;
        commentIndex: number;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<
    MessageItem & {
        spaceId: SpaceId;
        channelId: ChannelId;
        channelAccessPolicy: AccessPolicy;
    }
> {
    const [{spaceId, channelId, channelAccessPolicy}, item] = await runAllPromises([
        authorizePostAccess(context, postId, "View", {consistency}),
        getPostCommentItemIfExists(context, postId, commentIndex, {consistency}),
    ]);

    if (!item) throw createPostCommentNotFoundError(postId, commentIndex);

    return {
        spaceId,
        channelId,
        channelAccessPolicy,
        ...item,
    };
}

async function createPostCommentModelFromItem(
    context: ServerActionContext,
    spaceId: SpaceId,
    postId: PostId,
    item: MessageItem,
): Promise<PostCommentModel> {
    const [author, payload] = await runAllPromises([
        getAccount(context, spaceId, item.authorId),
        createMessagePayloadModel(
            context,
            spaceId,
            FilePostAuthorizer.bind({type: "PostComments", postId}),
            item.payload,
            item.stream,
        ),
    ]);

    return new PostCommentModel({
        postId,
        index: item.index,
        author,
        createdTime: item.createdTime,
        payload,
        stream: item.stream,
    });
}

/**
 * Update the content on one of your post comments.
 */
export function updatePostCommentContent(
    context: ServerAccountActionContext,
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
    spaceId: SpaceId;
    contentUpdatedTime: Date;
}> {
    return context.dynamo.retryTransaction(async context => {
        const postItemConsistency: DynamoReadConsistency = "Eventual";

        const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            },
            {
                consistency: postItemConsistency,
                attributes: [
                    "spaceId",
                    "channelId",
                    "authorId",
                    "createdTime",
                    "commentsSummary",
                    "updateLockVersion",
                ],
            },
        );

        // After we've loaded a post, save it to the authorization cache so if we need
        // to authorize later in the action it's available.
        PostItemAuthorizationCache.set(context, postItemConsistency, postId, postItemPromise);

        const [postItem, commentItem] = await runAllPromises([
            postItemPromise,
            ForumTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
            }),
        ]);

        if (!postItem) throw createPostNotFoundError(postId);

        const {spaceId} = await authorizeChannelAccess(context, postItem.channelId, "Comment");

        if (commentItem.authorId !== context.actor.getPossiblyBotAccountId())
            throw new PermissionDeniedError("Can only update post comments you authored");

        if (commentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can not update comments with a non-content payload");

        if (commentItem.payload.clerical)
            throw new FailedPreconditionError("Can’t update clerical comment content");

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

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            postItem.commentsSummary.mentionCountByAccountId,
            commentItem.payload.content,
            content,
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
            // Ok for us to not tell the client about a comment summary update through our
            // general realtime system. Instead, comment counts will be updated through the
            // messaging realtime system.
            ForumRealtimeTable.transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentIndex: postItem.commentsSummary.nextCommentIndex,
                    lastChangeTime: contentUpdatedTime,
                    commentCountByAuthorId: postItem.commentsSummary.commentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
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

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId,
            update: {
                type: "PostComment",
                postId,
                commentIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {
            spaceId,
            contentUpdatedTime,
        };
    });
}

/**
 * Delete a single post comment.
 */
export function deletePostComment(
    context: ServerAccountActionContext,
    {postId, commentIndex}: {postId: PostId; commentIndex: number},
): Promise<{deletedTime: Date}> {
    return context.dynamo.retryTransaction(async context => {
        const postItemConsistency: DynamoReadConsistency = "Eventual";

        const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
            context,
            {
                partitionType: "Post",
                sortRangeType: "Attributes",
                postId,
            },
            {
                consistency: postItemConsistency,
                attributes: [
                    "spaceId",
                    "channelId",
                    "authorId",
                    "createdTime",
                    "commentsSummary",
                    "updateLockVersion",
                ],
            },
        );

        // After we've loaded a post, save it to the authorization cache so if we need
        // to authorize later in the action it's available.
        PostItemAuthorizationCache.set(context, postItemConsistency, postId, postItemPromise);

        const [postItem, commentItem] = await runAllPromises([
            postItemPromise,
            ForumTable.getItem(context, {
                partitionType: "Post",
                sortRangeType: "Comments",
                postId,
                commentIndex,
            }),
        ]);

        if (!postItem) throw createPostNotFoundError(postId);

        const {spaceId} = await authorizeChannelAccess(context, postItem.channelId, "Comment");

        if (commentItem.authorId !== context.actor.getPossiblyBotAccountId())
            throw new PermissionDeniedError("Can only delete post comments you authored");

        if (commentItem.payload.type !== "Content")
            throw new FailedPreconditionError("Can’t delete comments with a non-content payload");

        if (commentItem.payload.clerical)
            throw new FailedPreconditionError("Can’t delete clerical comments");

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

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            postItem.commentsSummary.mentionCountByAccountId,
            commentItem.payload.content,
            null,
        );

        await DynamoTableSchema.executeTransaction(context, [
            ForumTable.transactionDirectlyUpdateItem({
                ...commentItem,
                payload: {type: "Deleted", deletedTime},
            }),
            // Ok for us to not tell the client about a comment summary update through our
            // general realtime system. Instead, comment counts will be updated through the
            // messaging realtime system.
            ForumRealtimeTable.transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentIndex: postItem.commentsSummary.nextCommentIndex,
                    lastChangeTime: deletedTime,
                    commentCountByAuthorId: postItem.commentsSummary.commentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
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

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId,
            update: {
                type: "PostComment",
                postId,
                commentIndex,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return {deletedTime};
    });
}

/**
 * Gets both the post model and the first few comments for the post in
 * one request.
 */
export async function getPostAndInitialComments(
    context: ServerActionContext,
    {
        postId,
        commentLimit,
    }: {
        postId: PostId;
        commentLimit: number;
    },
): Promise<{
    post: DynamoGeneralRealtimeItem<PostModel>;
    initialComments: Array<PostCommentModel>;
    initialOtherReferencedComments: Array<PostCommentModel>;
}> {
    // Start querying before authorization so our query runs in parallel
    // with authorization.
    const queryIterable = processCommentsQuery(
        "Ascending",
        ForumTable.query(context, {
            limit: "All",
            partitionKey: {
                partitionType: "Post",
                postId,
            },
            startSortKey: {
                sortRangeType: "Comments",
                commentIndex: 0,
            },
            endSortKey: {
                sortRangeType: "Comments#StreamPart",
                commentIndex: commentLimit - 1,
                partIndex: Number.MAX_SAFE_INTEGER,
            },
        }),
    );

    const postItem = await getPostItemWithContentForAuthorization(context, postId);

    const commentPromises: Array<Promise<PostCommentModel>> = [];

    const commentIndexes = new Set<number>();
    const parentCommentIndexes = new Set<number>();

    for await (const item of queryIterable) {
        commentIndexes.add(item.index);

        if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null)
            parentCommentIndexes.add(item.payload.parentMessageIndex);

        commentPromises.push(
            createPostCommentModelFromItem(context, postItem.spaceId, postId, item),
        );
    }

    const [, post, comments, otherReferencedComments] = await runAllPromises([
        authorizeChannelAccess(context, postItem.channelId, "View"),
        ForumRealtimeTable.buildRealtimeItem(context, postItem),
        runAllPromises(commentPromises),
        runAllPromises(
            filterMapIterable(parentCommentIndexes, parentCommentIndex => {
                if (commentIndexes.has(parentCommentIndex)) return;

                return (async () => {
                    const commentItem = await getPostCommentItemIfExists(
                        context,
                        postId,
                        parentCommentIndex,
                    );
                    if (!commentItem) throw new InternalError("Parent comment not found");

                    return createPostCommentModelFromItem(
                        context,
                        postItem.spaceId,
                        postId,
                        commentItem,
                    );
                })();
            }),
        ),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        post:
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            post.model.commentCount < lastCommentIndex + 1
                ? {...post, model: post.model.clone({commentCount: lastCommentIndex + 1})}
                : post,
        initialComments: comments,
        initialOtherReferencedComments: otherReferencedComments,
    };
}

function getPostCommentCount(commentsSummary: {
    readonly commentCountByAuthorId: ReadonlyMap<AccountId, number>;
}) {
    return reduceIterable(
        commentsSummary.commentCountByAuthorId.values(),
        (commentCount, authorCommentCount) => commentCount + authorCommentCount,
        0,
    );
}

/**
 * Paginate through post comments from start to finish.
 */
export async function getPostCommentsFromStart(
    context: ServerActionContext,
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
    const postItemConsistency: DynamoReadConsistency = "Eventual";

    const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            consistency: postItemConsistency,
            attributes: ["spaceId", "channelId", "authorId", "commentsSummary"],
        },
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, postItemConsistency, postId, postItemPromise);

    const [postItem, {comments, otherReferencedComments}] = await runAllPromises([
        postItemPromise.then(async postItem => {
            if (!postItem) throw createPostNotFoundError(postId);
            await authorizeChannelAccess(context, postItem.channelId, "View");
            return postItem;
        }),
        getPostCommentsFromStartAssumingAuthorizedPost(context, {
            postId,
            getSpaceId: () =>
                postItemPromise.then(postItem => {
                    if (!postItem) throw createPostNotFoundError(postId);
                    return postItem.spaceId;
                }),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            getPostCommentCount(postItem.commentsSummary),
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
    context: ServerActionContext,
    {
        postId,
        getSpaceId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency = "Eventual",
    }: {
        postId: PostId;
        getSpaceId: () => Promise<SpaceId>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    comments: Array<PostCommentModel>;
    otherReferencedComments: Array<PostCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const queryStartCommentIndex =
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0;

    const queryEndCommentIndex = Math.min(
        queryStartCommentIndex + limit - 1,
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const commentItems = await arrayFromAsyncIterable(
        processCommentsQuery(
            "Ascending",
            ForumTable.query(context, {
                limit: "All",
                consistency,
                partitionKey: {
                    partitionType: "Post",
                    postId,
                },
                startSortKey: {
                    sortRangeType: "Comments",
                    commentIndex: queryStartCommentIndex,
                },
                endSortKey: {
                    sortRangeType: "Comments#StreamPart",
                    commentIndex: queryEndCommentIndex,
                    partIndex: Number.MAX_SAFE_INTEGER,
                },
            }),
        ),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const startCommentIndex = commentItems[0]!.index;
    const endCommentIndex = commentItems[commentItems.length - 1]!.index;

    const spaceId = await getSpaceId();

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<PostCommentModel> = [];

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need
        // to load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await getPostCommentItemIfExists(context, postId, commentIndex, {
                    consistency,
                });
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                    loadOtherReferencedComment(item.payload.parentMessageIndex);
                }

                otherReferencedComments.push(
                    await createPostCommentModelFromItem(context, spaceId, postId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                loadOtherReferencedComment(item.payload.parentMessageIndex);
            }

            // Don't propagate `consistency` when loading model references. We
            // accept references can have eventual consistency.
            return createPostCommentModelFromItem(context, spaceId, postId, item);
        }),
    );

    // Keep loading other referenced comments until we have all of them. A
    // referenced comment may itself reference more comments.
    while (otherReferencedCommentPromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedCommentPromiseByIndex.values());
        otherReferencedCommentPromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    return {
        comments,
        otherReferencedComments: otherReferencedComments.sort(
            (comment1, comment2) => comment1.index - comment2.index,
        ),
    };
}

/**
 * Paginate through post comments from start to finish.
 */
export async function getPostCommentPayloadsFromStart(
    context: ServerActionContext,
    {
        postId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency = "Eventual",
    }: {
        postId: PostId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    commentCount: number;
    comments: Array<MessageItem>;
}> {
    const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            consistency,
            attributes: ["spaceId", "channelId", "authorId", "commentsSummary"],
        },
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, consistency, postId, postItemPromise);

    const queryStartCommentIndex =
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0;

    const queryEndCommentIndex = Math.min(
        queryStartCommentIndex + limit - 1,
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER,
    );

    const [postItem, commentItems] = await runAllPromises([
        postItemPromise.then(async postItem => {
            if (!postItem) throw createPostNotFoundError(postId);
            await authorizeChannelAccess(context, postItem.channelId, "View", {consistency});
            return postItem;
        }),
        arrayFromAsyncIterable(
            processCommentsQuery(
                "Ascending",
                ForumTable.query(context, {
                    limit: "All",
                    consistency,
                    partitionKey: {
                        partitionType: "Post",
                        postId,
                    },
                    startSortKey: {
                        sortRangeType: "Comments",
                        commentIndex: queryStartCommentIndex,
                    },
                    endSortKey: {
                        sortRangeType: "Comments#StreamPart",
                        commentIndex: queryEndCommentIndex,
                        partIndex: Number.MAX_SAFE_INTEGER,
                    },
                }),
            ),
        ),
    ]);

    const lastCommentIndex =
        commentItems.length > 0 ? commentItems[commentItems.length - 1]!.index : -1;

    return {
        spaceId: postItem.spaceId,
        commentCount: Math.max(
            getPostCommentCount(postItem.commentsSummary),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments: commentItems,
    };
}

/**
 * Paginate through post comments from finish to start.
 */
export async function getPostCommentsFromEnd(
    context: ServerActionContext,
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
    const postItemConsistency: DynamoReadConsistency = "Eventual";

    const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            consistency: postItemConsistency,
            attributes: ["spaceId", "channelId", "authorId", "commentsSummary"],
        },
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, postItemConsistency, postId, postItemPromise);

    const [postItem, {comments, otherReferencedComments}] = await runAllPromises([
        postItemPromise.then(async postItem => {
            if (!postItem) throw createPostNotFoundError(postId);
            await authorizeChannelAccess(context, postItem.channelId, "View");
            return postItem;
        }),
        getPostCommentsFromEndAssumingAuthorizedPost(context, {
            postId,
            postItemPromise: postItemPromise.then(postItem => {
                if (!postItem) throw createPostNotFoundError(postId);
                return postItem;
            }),
            limit,
            afterCommentIndex,
            beforeCommentIndex,
        }),
    ]);

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        commentCount: Math.max(
            getPostCommentCount(postItem.commentsSummary),
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
    context: ServerActionContext,
    {
        postId,
        postItemPromise,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
    }: {
        postId: PostId;
        postItemPromise: Promise<{
            spaceId: SpaceId;
            commentsSummary: {commentCountByAuthorId: ReadonlyMap<AccountId, number>};
        }>;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
    },
): Promise<{
    comments: Array<PostCommentModel>;
    otherReferencedComments: Array<PostCommentModel>;
}> {
    if (limit === 0) return {comments: [], otherReferencedComments: []};

    const queryStartCommentIndex = Math.max(
        typeof beforeCommentIndex === "number"
            ? beforeCommentIndex - limit
            : // TODO(calebmer): An optimized version of this might query `limit` items and if there
              // was a message stream then query again with `limit: "All"` and a proper query start
              // index. Instead right now we wait for chat access to authorize before starting our
              // query which is slower than authorizing + querying in parallel.
              getPostCommentCount((await postItemPromise).commentsSummary) - limit,
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
    );

    const queryEndCommentIndex =
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER;

    const commentItems = await arrayFromAsyncIterable(
        typeof beforeCommentIndex !== "number" || beforeCommentIndex > 0
            ? processCommentsQuery(
                  "Descending",
                  ForumTable.query(context, {
                      limit: "All",
                      // Scan backwards from `endSortKey` to `startSortKey` so we can get comments
                      // at the end instead of start.
                      descending: true,
                      partitionKey: {
                          partitionType: "Post",
                          postId,
                      },
                      startSortKey: {
                          sortRangeType: "Comments",
                          commentIndex: queryStartCommentIndex,
                      },
                      endSortKey: {
                          sortRangeType: "Comments#StreamPart",
                          commentIndex: queryEndCommentIndex,
                          partIndex: Number.MAX_SAFE_INTEGER,
                      },
                  }),
              )
            : (async function* () {})(),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const endCommentIndex = commentItems[0]!.index;
    const startCommentIndex = commentItems[commentItems.length - 1]!.index;

    const {spaceId} = await postItemPromise;

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<PostCommentModel> = [];

    const loadOtherReferencedComment = (commentIndex: number) => {
        // If this message is already in our loaded messages range then we don't need
        // to load it again.
        if (startCommentIndex <= commentIndex && commentIndex <= endCommentIndex) return;

        const promise = getOrSetDefaultMapValue(
            otherReferencedCommentPromiseByIndex,
            commentIndex,
            async () => {
                const item = await getPostCommentItemIfExists(context, postId, commentIndex);
                if (!item) throw new InternalError("Parent comment not found");

                // Recursively load any referenced parent messages...
                if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                    loadOtherReferencedComment(item.payload.parentMessageIndex);
                }

                otherReferencedComments.push(
                    await createPostCommentModelFromItem(context, spaceId, postId, item),
                );
            },
        );

        // We await this promise later.
        void promise;
    };

    const comments = await runAllPromises(
        commentItems.map(item => {
            if (item.payload.type === "Content" && item.payload.parentMessageIndex !== null) {
                loadOtherReferencedComment(item.payload.parentMessageIndex);
            }
            return createPostCommentModelFromItem(context, spaceId, postId, item);
        }),
    );

    // Keep loading other referenced comments until we have all of them. A
    // referenced comment may itself reference more comments.
    while (otherReferencedCommentPromiseByIndex.size > 0) {
        const promises = Array.from(otherReferencedCommentPromiseByIndex.values());
        otherReferencedCommentPromiseByIndex = new Map();
        await runAllPromises(promises);
    }

    // We queried in descending order so put comments back in the right order.
    comments.reverse();

    return {
        comments,
        otherReferencedComments: otherReferencedComments.sort(
            (comment1, comment2) => comment1.index - comment2.index,
        ),
    };
}

/**
 * Paginate through post comments from finish to start.
 */
export async function getPostCommentPayloadsFromEnd(
    context: ServerActionContext,
    {
        postId,
        limit,
        afterCommentIndex,
        beforeCommentIndex,
        consistency = "Eventual",
    }: {
        postId: PostId;
        limit: number;
        afterCommentIndex: number | null;
        beforeCommentIndex: number | null;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    spaceId: SpaceId;
    commentCount: number;
    comments: Array<MessageItem>;
}> {
    const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            consistency,
            attributes: ["spaceId", "channelId", "authorId", "commentsSummary"],
        },
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, consistency, postId, postItemPromise);

    const actualPostItemPromise = postItemPromise.then(postItem => {
        if (!postItem) throw createPostNotFoundError(postId);
        return postItem;
    });

    const queryStartCommentIndex = Math.max(
        typeof beforeCommentIndex === "number"
            ? beforeCommentIndex - limit
            : // TODO(calebmer): An optimized version of this might query `limit` items and if there
              // was a message stream then query again with `limit: "All"` and a proper query start
              // index. Instead right now we wait for chat access to authorize before starting our
              // query which is slower than authorizing + querying in parallel.
              getPostCommentCount((await actualPostItemPromise).commentsSummary) - limit,
        typeof afterCommentIndex === "number" ? afterCommentIndex + 1 : 0,
    );

    const queryEndCommentIndex =
        typeof beforeCommentIndex === "number" ? beforeCommentIndex - 1 : Number.MAX_SAFE_INTEGER;

    const [postItem, comments] = await runAllPromises([
        actualPostItemPromise.then(async postItem => {
            await authorizeChannelAccess(context, postItem.channelId, "View", {consistency});
            return postItem;
        }),
        arrayFromAsyncIterable(
            processCommentsQuery(
                "Descending",
                ForumTable.query(context, {
                    limit: "All",
                    descending: true,
                    consistency,
                    partitionKey: {
                        partitionType: "Post",
                        postId,
                    },
                    startSortKey: {
                        sortRangeType: "Comments",
                        commentIndex: queryStartCommentIndex,
                    },
                    endSortKey: {
                        sortRangeType: "Comments#StreamPart",
                        commentIndex: queryEndCommentIndex,
                        partIndex: Number.MAX_SAFE_INTEGER,
                    },
                }),
            ),
        ),
    ]);

    // We queried in descending order so put comments back in the right order.
    comments.reverse();

    const lastCommentIndex = comments.length > 0 ? comments[comments.length - 1]!.index : -1;

    return {
        spaceId: postItem.spaceId,
        commentCount: Math.max(
            getPostCommentCount(postItem.commentsSummary),
            // Make sure `commentCount` is consistent with `comments` in case of eventual
            // consistency race conditions.
            lastCommentIndex + 1,
        ),
        comments,
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
    context: ServerActionContext,
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
    const postItemConsistency: DynamoReadConsistency = "Eventual";

    const postItemPromise = ForumRealtimeTable.getPartialItemIfExists(
        context,
        {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
        },
        {
            consistency: postItemConsistency,
            attributes: ["spaceId", "channelId", "authorId", "createdTime", "commentsSummary"],
        },
    );

    // After we've loaded a post, save it to the authorization cache so if we need
    // to authorize later in the action it's available.
    PostItemAuthorizationCache.set(context, postItemConsistency, postId, postItemPromise);

    const [[postItem, commentChangesResult], {comments, otherReferencedComments}] =
        await runAllPromises([
            postItemPromise.then(async postItem => {
                if (!postItem) throw createPostNotFoundError(postId);

                const [, commentChangesResult] = await runAllPromises([
                    authorizeChannelAccess(context, postItem.channelId, "View"),
                    queryPostCommentChangeLogAssumingAuthorizedPost(context, {
                        postItem,
                        lastCommentChangeTime: clientLastCommentChangeTime,
                        // Use a strong read consistency when backfilling. This guarantees the caller
                        // will observe all realtime events before this function call. Realtime events
                        // that happen during the function call may be missed. You should be subscribed
                        // to new realtime events before starting to backfill.
                        consistency: "Strong",
                    }),
                ]);

                return [postItem, commentChangesResult] as const;
            }),
            getPostCommentsFromStartAssumingAuthorizedPost(context, {
                postId,
                getSpaceId: () =>
                    postItemPromise.then(postItem => {
                        if (!postItem) throw createPostNotFoundError(postId);
                        return postItem.spaceId;
                    }),
                limit: newCommentLimit,
                afterCommentIndex: clientCommentCount - 1,
                beforeCommentIndex: null,
                // Use a strong read consistency when backfilling. This guarantees the caller
                // will observe all realtime events before this function call. Realtime events
                // that happen during the function call may be missed. You should be subscribed
                // to new realtime events before starting to backfill.
                consistency: "Strong",
            }),
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
    context: ServerActionContext,
    {
        postItem,
        lastCommentChangeTime,
        consistency = "Eventual",
    }: {
        postItem: Pick<
            PostAttributesItem,
            "postId" | "spaceId" | "createdTime" | "commentsSummary"
        >;
        lastCommentChangeTime: Date | null;
        consistency?: DynamoCacheReadConsistency;
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
    if (
        isDatePossiblyLessThanWithUncertaintyWindow(
            lastCommentChangeExpirationTime,
            // Use `Date.now()` so tests can mock the `Date.now()` function.
            new Date(Date.now()),
        )
    ) {
        return {type: "Unavailable"};
    }

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
            consistency,
        }),
        async (item): Promise<MessageChange> => {
            switch (item.change.type) {
                case "UpdateContent": {
                    return {
                        type: "UpdateContent",
                        index: item.commentIndex,
                        content: {
                            doc: item.change.content,

                            // Don't propagate `consistency` when loading content references. We
                            // accept references can have eventual consistency.
                            references: await getMessageContentReferencesForNode(
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
