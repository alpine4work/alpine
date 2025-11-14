import {addDays, addSeconds} from "date-fns";
import {Step} from "prosemirror-transform";
import {
    applyMentionCountByAccountIdDifferenceFromContentUpdate,
    getMentionedAccountIdsInContent,
} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
    ServerBotActionContext,
} from "~/server/context/server_action_context.js";
import {ServerSessionActionContextWithApns} from "~/server/context/server_session_action_context_with_apns.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoItem, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {getFileFromAttachment} from "~/server/files/data/files_actions.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {authorizePostAccess} from "~/server/forum/data/authorize_post_access.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ForumTable} from "~/server/forum/data/internal/forum_table.js";
import {
    getPostItemForAuthorization,
    getPostItemForAuthorizationIfExists,
    getPostItemWithContentForAuthorization,
} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {maxChannelContributionCount} from "~/server/forum/data/max_channel_contribution_count.js";
import {computeUpdateMessageContent} from "~/server/messaging/helpers/compute_update_message_content.js";
import {createMessagePayloadModel} from "~/server/messaging/helpers/create_message_payload_model.js";
import {messageStreamIndexSearchEntityDelaySeconds} from "~/server/messaging/helpers/message_stream_index_search_entity_delay_seconds.js";
import {MessageItem} from "~/server/messaging/helpers/process_messages_query.js";
import {
    messagingEventExpirationDays,
    runBackfillMessageUpdates,
} from "~/server/messaging/helpers/run_backfill_message_updates.js";
import {runCommentsQuery} from "~/server/messaging/helpers/run_comments_query.js";
import {validateMessageContentPayloadMessagesRangeParent} from "~/server/messaging/helpers/validate_message_content_payload_messages_range_parent.js";
import {getNotificationMessageContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {getAccount, isAccountMemberOfSpace} from "~/server/spaces/spaces_actions.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {
    FailedPreconditionError,
    InternalError,
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
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {sumIterable} from "~/shared/helpers/iterable/sum_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, ChannelId, FileId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {computeDeleteMessageReaction} from "~/shared/messaging/compute_delete_message_reaction.js";
import {computeSetMessageReaction} from "~/shared/messaging/compute_set_message_reaction.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {
    MessageContentPayloadContentUpdate,
    MessageContentPayloadParent,
    MessageStreamPartPayload,
    iterateMessageContentPayloadParentIndexes,
} from "~/shared/messaging/message_schema.js";
import {MessageUpdatesBackfillResult} from "~/shared/messaging/messaging_realtime_protocol.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

/**
 * Add a new comment to a post.
 */
export async function createPostComment(
    context: ServerAccountActionContext,
    {
        postId,
        parent,
        content,
        createdTimeZone,
        fileIds,
        isStream,
        consistency = "Eventual",
    }: {
        postId: PostId;
        parent: MessageContentPayloadParent | null;
        content: MessageContent;
        createdTimeZone: TimeZone;
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
        const postItemPromise = getPostItemForAuthorizationIfExists(context, postId, {consistency});

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
                if (!parent) return;

                switch (parent.type) {
                    case "Message": {
                        await ForumTable.getItem(context, {
                            partitionType: "Post",
                            sortRangeType: "Comments",
                            postId,
                            commentIndex: parent.index,
                        });
                        break;
                    }
                    case "MessagesRange": {
                        const commentItems = await arrayFromAsyncIterable(
                            runCommentsQuery(context, {
                                cache: PostCommentItemContextCache,
                                cacheKeyPrefix: postId,
                                consistency,
                                startIndex: parent.startIndex,
                                endIndex: parent.endIndex,
                                query: ({consistency, limit, startSortKey, endSortKey}) =>
                                    ForumTable.query(context, {
                                        consistency,
                                        limit,
                                        partitionKey: {partitionType: "Post", postId},
                                        startSortKey,
                                        endSortKey,
                                    }),
                            }),
                        );

                        validateMessageContentPayloadMessagesRangeParent(parent, commentItems);
                        break;
                    }
                    case "PostRange": {
                        const postItem = await postItemPromise;
                        if (!postItem) throw createPostNotFoundError(postId);

                        if (
                            parent.contentVersion > (postItem.contentUpdate?.mappings.length ?? 0)
                        ) {
                            throw new FailedPreconditionError("Invalid post range content version");
                        }
                        break;
                    }
                    default:
                        throw exhaustive(parent);
                }
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
            ForumTable.transactionCreateItem(
                {
                    partitionType: "Post",
                    sortRangeType: "Comments",
                    postId,
                    commentIndex,
                    authorId,
                    createdTimeZone,
                    createdTime,
                    payload: {
                        type: "Content",
                        parent,
                        content,
                        contentUpdate: null,
                        fileIds,
                        clerical: isStream ? {type: "Stream"} : undefined,
                        reactionsByPos: emptyMap,
                    },
                },
                // Retry in case of a race condition where another process writes to this
                // `commentIndex` before us.
                {isConditionCheckErrorRetriable: true},
            ),

            // Ok for us to not tell the client about a comment summary update through our
            // general realtime system. Instead, comment counts will be updated through the
            // messaging realtime system.
            ForumRealtimeTable.transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentIndex: postItem.commentsSummary.nextCommentIndex + 1,
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
                          lastPartCreatedTime: null,
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
                        contributorsItem ??= DynamoItem.create({
                            partitionType: "Channel",
                            sortRangeType: "Contributors",
                            channelId: postItem.channelId,
                            spaceId: postItem.spaceId,
                            contributionCountByAccountId: new Map(),
                            accountIdsWithGrant: emptyArray,
                        });

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

                        return contributorsItem.update({
                            contributionCountByAccountId: newContributionCountByAccountId,
                        });
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
    createdTime: Date;
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

        let createdTime: Date;
        if (partIndex === item.partCount) {
            createdTime = new Date();
            const createPartTransactionEntry = ForumTable.transactionCreateOrReplaceItem({
                partitionType: "Post",
                sortRangeType: "Comments#StreamPart",
                postId,
                commentIndex,
                partIndex,
                payload,
                createdTime,
                // `updateLockVersion: 0` is always represented as `undefined`.
                updateLockVersion: undefined,
            });

            version = createPartTransactionEntry.newItem.updateLockVersion ?? 0;

            await DynamoTableSchema.executeTransaction(context, [
                ForumTable.transactionDirectlyUpdateItem({
                    ...item,
                    partCount: partIndex + 1,
                    lastPartUpdateLockVersion: 0,
                    lastPartCreatedTime: createdTime,
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
            assert(item.lastPartCreatedTime !== null);
            createdTime = item.lastPartCreatedTime;

            const updatePartTransactionEntry = ForumTable.transactionCreateOrReplaceItem({
                partitionType: "Post",
                sortRangeType: "Comments#StreamPart",
                postId,
                commentIndex,
                partIndex,
                payload,
                createdTime,
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

        return {spaceId, version, createdTime};
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

const PostCommentItemContextCache = new DynamoContextCache<
    `${PostId}:${number}`,
    MessageItem | null
>({
    // Allow sharing this cache because the results do not depend on who the
    // actor is.
    whenActorChanges: "DangerouslyShare",
});

async function getPostCommentItemIfExists(
    context: ServerActionContext,
    postId: PostId,
    commentIndex: number,
    {consistency}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<MessageItem | null> {
    const items = await arrayFromAsyncIterable(
        runCommentsQuery(context, {
            cache: PostCommentItemContextCache,
            cacheKeyPrefix: postId,
            consistency,
            startIndex: commentIndex,
            endIndex: commentIndex,
            query: ({consistency, limit, startSortKey, endSortKey}) =>
                ForumTable.query(context, {
                    consistency,
                    limit,
                    partitionKey: {partitionType: "Post", postId},
                    startSortKey,
                    endSortKey,
                }),
        }),
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
 * Get a post comment with a version that's either equal to or greater than the
 * provided version.
 */
export async function getPostCommentAtVersion(
    context: ServerActionContext,
    {postId, commentIndex, version}: {postId: PostId; commentIndex: number; version: number},
): Promise<PostCommentModel> {
    const [{spaceId}, item] = await runAllPromises([
        authorizePostAccess(context, postId, "View"),
        (async () => {
            let item = await getPostCommentItemIfExists(context, postId, commentIndex, {
                consistency: "Eventual",
            });

            if (!item || item.version < version) {
                item = await getPostCommentItemIfExists(context, postId, commentIndex, {
                    consistency: "Strong",
                });
            }

            if (!item) {
                throw createPostCommentNotFoundError(postId, commentIndex);
            }

            if (item.version < version) {
                throw new FailedPreconditionError("Can’t get message at a future version");
            }

            return item;
        })(),
    ]);

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
        version: item.version,
        author,
        createdTime: item.createdTime,
        createdTimeZone: item.createdTimeZone,
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
        contentVersion,
        steps,
    }: {
        postId: PostId;
        commentIndex: number;
        contentVersion: number;
        steps: ReadonlyArray<Step>;
    },
): Promise<{
    spaceId: SpaceId;
    version: number;
    content: MessageContent;
    contentUpdate: MessageContentPayloadContentUpdate;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [postItem, commentItem] = await runAllPromises([
            getPostItemForAuthorizationIfExists(context, postId),
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

        const {oldPayload, newPayload} = computeUpdateMessageContent(
            commentItem,
            contentVersion,
            steps,
        );

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            postItem.commentsSummary.mentionCountByAccountId,
            oldPayload.content,
            newPayload.content,
        );

        const transactionEntry = ForumTable.transactionDirectlyUpdateItem({
            ...commentItem,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Ok for us to not tell the client about a comment summary update through our
            // general realtime system. Instead, comment counts will be updated through the
            // messaging realtime system.
            ForumRealtimeTable.transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentIndex: postItem.commentsSummary.nextCommentIndex,
                    commentCountByAuthorId: postItem.commentsSummary.commentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: postItem.updateLockVersion},
            ),

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version`
            // are all in the item key. So we won't be replacing any existing update item.
            ForumTable.transactionCreateOrReplaceItem({
                partitionType: "Post",
                sortRangeType: "MessageUpdates",
                postId,
                eventTime: newPayload.contentUpdate.time,
                messageIndex: commentItem.commentIndex,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(
                    newPayload.contentUpdate.time,
                    messagingEventExpirationDays,
                ),
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
            version: transactionEntry.newItem.updateLockVersion ?? 0,
            content: newPayload.content,
            contentUpdate: newPayload.contentUpdate,
        };
    });
}

/**
 * Delete a single post comment.
 */
export function deletePostComment(
    context: ServerAccountActionContext,
    {postId, commentIndex}: {postId: PostId; commentIndex: number},
): Promise<{version: number; deletedTime: Date}> {
    return context.dynamo.retryTransaction(async context => {
        const [postItem, commentItem] = await runAllPromises([
            getPostItemForAuthorizationIfExists(context, postId),
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

        const deletedTime = new Date();

        const newMentionCountByAccountId = applyMentionCountByAccountIdDifferenceFromContentUpdate(
            postItem.commentsSummary.mentionCountByAccountId,
            commentItem.payload.content,
            null,
        );

        const transactionEntry = ForumTable.transactionDirectlyUpdateItem({
            ...commentItem,
            payload: {type: "Deleted", deletedTime},
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Ok for us to not tell the client about a comment summary update through our
            // general realtime system. Instead, comment counts will be updated through the
            // messaging realtime system.
            ForumRealtimeTable.transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent(
                {partitionType: "Post", sortRangeType: "Attributes", postId},
                "commentsSummary",
                {
                    nextCommentIndex: postItem.commentsSummary.nextCommentIndex,
                    commentCountByAuthorId: postItem.commentsSummary.commentCountByAuthorId,
                    mentionCountByAccountId: newMentionCountByAccountId,
                },
                {updateLockVersion: postItem.updateLockVersion},
            ),

            // Create-or-replace is safe because `eventTime`, `messageIndex`, and `version`
            // are all in the item key. So we won't be replacing any existing update item.
            ForumTable.transactionCreateOrReplaceItem({
                partitionType: "Post",
                sortRangeType: "MessageUpdates",
                postId,
                eventTime: deletedTime,
                messageIndex: commentItem.commentIndex,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(deletedTime, messagingEventExpirationDays),
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
            version: transactionEntry.newItem.updateLockVersion ?? 0,
            deletedTime,
        };
    });
}

export function setPostCommentReaction(
    context: ServerSessionActionContextWithApns,
    {
        postId,
        commentIndex,
        contentVersion,
        pos,
        reaction,
    }: {
        postId: PostId;
        commentIndex: number;
        contentVersion: number;
        pos: number;
        reaction: Reaction | "GenericLike";
    },
) {
    return context.dynamo.retryTransaction(async context => {
        const [postItem, commentItem] = await runAllPromises([
            getPostItemForAuthorization(context, postId),
            getPostCommentItemIfExists(context, postId, commentIndex),
        ]);

        if (!commentItem) throw createPostCommentNotFoundError(postId, commentIndex);

        await authorizeChannelAccess(context, postItem.channelId, "Comment");

        const currentTime = new Date();

        const newPayload = computeSetMessageReaction({
            actorAccountId: context.actor.getPossiblyBotAccountId(),
            message: commentItem,
            contentVersion,
            pos,
            reaction,
        });

        const transactionEntry = ForumTable.transactionDirectlyUpdateItem({
            ...omitObject(commentItem, ["index", "version"]),
            partitionType: "Post",
            sortRangeType: "Comments",
            postId,
            commentIndex: commentItem.index,
            updateLockVersion: commentItem.version,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `commentIndex`, and `version`
            // are all in the item key. So we won't be replacing any existing update item.
            ForumTable.transactionCreateOrReplaceItem({
                partitionType: "Post",
                sortRangeType: "MessageUpdates",
                postId,
                eventTime: currentTime,
                messageIndex: commentItem.index,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(currentTime, messagingEventExpirationDays),
            }),
        ]);

        context.process.waitUntil(
            context.notificationsInjection.archiveInboxPostCommentsEntryAfterSetPostCommentReaction(
                {
                    spaceId: postItem.spaceId,
                    postId,
                    commentCount: getPostCommentCount(postItem.commentsSummary),
                    commentIndex,
                },
            ),
        );

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
        };
    });
}

export function deletePostCommentReaction(
    context: ServerAccountActionContext,
    {
        postId,
        commentIndex,
        contentVersion,
        pos,
    }: {
        postId: PostId;
        commentIndex: number;
        contentVersion: number;
        pos: number;
    },
) {
    return context.dynamo.retryTransaction(async context => {
        const [postItem, commentItem] = await runAllPromises([
            getPostItemForAuthorization(context, postId),
            getPostCommentItemIfExists(context, postId, commentIndex),
        ]);

        if (!commentItem) throw createPostCommentNotFoundError(postId, commentIndex);

        await authorizeChannelAccess(context, postItem.channelId, "Comment");

        const currentTime = new Date();

        const newPayload = computeDeleteMessageReaction({
            actorAccountId: context.actor.getPossiblyBotAccountId(),
            message: commentItem,
            contentVersion,
            pos,
        });

        const transactionEntry = ForumTable.transactionDirectlyUpdateItem({
            ...omitObject(commentItem, ["index", "version"]),
            partitionType: "Post",
            sortRangeType: "Comments",
            postId,
            commentIndex: commentItem.index,
            updateLockVersion: commentItem.version,
            payload: newPayload,
        });

        await DynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            // Create-or-replace is safe because `eventTime`, `commentIndex`, and `version`
            // are all in the item key. So we won't be replacing any existing update item.
            ForumTable.transactionCreateOrReplaceItem({
                partitionType: "Post",
                sortRangeType: "MessageUpdates",
                postId,
                eventTime: currentTime,
                messageIndex: commentItem.index,
                version: transactionEntry.newItem.updateLockVersion ?? 0,
                expirationTime: addDays(currentTime, messagingEventExpirationDays),
            }),
        ]);

        return {
            version: transactionEntry.newItem.updateLockVersion ?? 0,
        };
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
    const queryIterable = runCommentsQuery(context, {
        cache: PostCommentItemContextCache,
        cacheKeyPrefix: postId,
        consistency: undefined,
        startIndex: 0,
        endIndex: commentLimit - 1,
        query: ({consistency, limit, startSortKey, endSortKey}) =>
            ForumTable.query(context, {
                consistency,
                limit,
                partitionKey: {partitionType: "Post", postId},
                startSortKey,
                endSortKey,
            }),
    });

    const postItem = await getPostItemWithContentForAuthorization(context, postId);

    const commentPromises: Array<Promise<PostCommentModel>> = [];

    const commentIndexes = new Set<number>();
    const parentCommentIndexes = new Set<number>();

    for await (const item of queryIterable) {
        commentIndexes.add(item.index);

        if (item.payload.type === "Content" && item.payload.parent !== null) {
            for (const index of iterateMessageContentPayloadParentIndexes(item.payload.parent)) {
                parentCommentIndexes.add(index);
            }
        }

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
    return sumIterable(commentsSummary.commentCountByAuthorId.values());
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
}> {
    const postItemPromise = getPostItemForAuthorizationIfExists(context, postId);

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
        runCommentsQuery(context, {
            cache: PostCommentItemContextCache,
            cacheKeyPrefix: postId,
            consistency,
            startIndex: queryStartCommentIndex,
            endIndex: queryEndCommentIndex,
            query: ({consistency, limit, startSortKey, endSortKey}) =>
                ForumTable.query(context, {
                    consistency,
                    limit,
                    partitionKey: {partitionType: "Post", postId},
                    startSortKey,
                    endSortKey,
                }),
        }),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const startCommentIndex = commentItems[0]!.index;
    const endCommentIndex = commentItems[commentItems.length - 1]!.index;

    const spaceId = await getSpaceId();

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<PostCommentModel> = [];

    const loadOtherReferencedCommentFromParent = (parent: MessageContentPayloadParent) => {
        for (const index of iterateMessageContentPayloadParentIndexes(parent)) {
            loadOtherReferencedComment(index);
        }
    };

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
                if (item.payload.type === "Content" && item.payload.parent !== null) {
                    loadOtherReferencedCommentFromParent(item.payload.parent);
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
            if (item.payload.type === "Content" && item.payload.parent !== null) {
                loadOtherReferencedCommentFromParent(item.payload.parent);
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
    const postItemPromise = getPostItemForAuthorizationIfExists(context, postId, {consistency});

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
            runCommentsQuery(context, {
                cache: PostCommentItemContextCache,
                cacheKeyPrefix: postId,
                consistency,
                startIndex: queryStartCommentIndex,
                endIndex: queryEndCommentIndex,
                query: ({consistency, limit, startSortKey, endSortKey}) =>
                    ForumTable.query(context, {
                        consistency,
                        limit,
                        partitionKey: {partitionType: "Post", postId},
                        startSortKey,
                        endSortKey,
                    }),
            }),
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
}> {
    const postItemPromise = getPostItemForAuthorizationIfExists(context, postId);

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
            ? runCommentsQuery(context, {
                  cache: PostCommentItemContextCache,
                  cacheKeyPrefix: postId,
                  consistency: undefined,
                  startIndex: queryStartCommentIndex,
                  endIndex: queryEndCommentIndex,
                  query: ({consistency, limit, startSortKey, endSortKey}) =>
                      ForumTable.query(context, {
                          consistency,
                          limit,
                          partitionKey: {partitionType: "Post", postId},
                          startSortKey,
                          endSortKey,
                      }),
              })
            : (async function* () {})(),
    );

    if (commentItems.length === 0) return {comments: [], otherReferencedComments: []};

    const startCommentIndex = commentItems[0]!.index;
    const endCommentIndex = commentItems[commentItems.length - 1]!.index;

    const {spaceId} = await postItemPromise;

    let otherReferencedCommentPromiseByIndex = new Map<number, Promise<void>>();
    const otherReferencedComments: Array<PostCommentModel> = [];

    const loadOtherReferencedCommentFromParent = (parent: MessageContentPayloadParent) => {
        for (const index of iterateMessageContentPayloadParentIndexes(parent)) {
            loadOtherReferencedComment(index);
        }
    };

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
                if (item.payload.type === "Content" && item.payload.parent !== null) {
                    loadOtherReferencedCommentFromParent(item.payload.parent);
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
            if (item.payload.type === "Content" && item.payload.parent !== null) {
                loadOtherReferencedCommentFromParent(item.payload.parent);
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
    const postItemPromise = getPostItemForAuthorizationIfExists(context, postId, {consistency});

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
            runCommentsQuery(context, {
                cache: PostCommentItemContextCache,
                cacheKeyPrefix: postId,
                consistency,
                startIndex: queryStartCommentIndex,
                endIndex: queryEndCommentIndex,
                query: ({consistency, limit, startSortKey, endSortKey}) =>
                    ForumTable.query(context, {
                        consistency,
                        limit,
                        partitionKey: {partitionType: "Post", postId},
                        startSortKey,
                        endSortKey,
                    }),
            }),
        ),
    ]);

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
        checkpoint,
        clientCommentCount,
        newCommentLimit,
    }: {
        postId: PostId;
        checkpoint: ServerSynchronizationCheckpoint;
        clientCommentCount: number;
        newCommentLimit: number;
    },
): Promise<{
    commentCount: number;
    newComments: Array<PostCommentModel>;
    newOtherReferencedComments: Array<PostCommentModel>;
    commentUpdatesResult: MessageUpdatesBackfillResult<PostCommentModel>;
}> {
    const postItemPromise = getPostItemForAuthorizationIfExists(context, postId);

    const [postItem, {comments, otherReferencedComments}, commentUpdatesResult] =
        await runAllPromises([
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
                limit: newCommentLimit,
                afterCommentIndex: clientCommentCount - 1,
                beforeCommentIndex: null,
                // Use a strong read consistency when backfilling. This guarantees the caller
                // will observe all realtime events before this function call. Realtime events
                // that happen during the function call may be missed. You should be subscribed
                // to new realtime events before starting to backfill.
                consistency: "Strong",
            }),
            runBackfillMessageUpdates(context, {
                checkpoint,
                queryMessageUpdates: (context, options) =>
                    ForumTable.query(context, {
                        partitionKey: {partitionType: "Post", postId},
                        ...options,
                    }),
                getMessageIfExists: (context, messageIndex, options) =>
                    getPostCommentItemIfExists(context, postId, messageIndex, options),
                createMessageModelFromItem: async (context, item) => {
                    const postItem = await postItemPromise;
                    if (!postItem) throw createPostNotFoundError(postId);
                    return createPostCommentModelFromItem(context, postItem.spaceId, postId, item);
                },
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
        newComments: comments,
        newOtherReferencedComments: otherReferencedComments,
        commentUpdatesResult,
    };
}
