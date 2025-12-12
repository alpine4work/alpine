import {
    getMentionCountByAccountIdInContent,
    getMentionedAccountIdsInContent,
} from "~/server/content/get_mentioned_account_ids_in_content.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
    ServerImpersonatedAccountActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {addFeedCandidateEntry} from "~/server/feed/feed_actions.js";
import {
    attachFileFromAttachment,
    detachFile,
    getPostDraftFileAttachments,
} from "~/server/files/data/files_actions.js";
import {authorizeChannelAccess} from "~/server/forum/data/authorize_channel_access.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {
    ForumRealtimeTable,
    PostAttributesItem,
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ForumTable} from "~/server/forum/data/internal/forum_table.js";
import {getPostContentFileIds} from "~/server/forum/data/internal/get_post_content_file_ids.js";
import {PostItemAuthorizationCache} from "~/server/forum/data/internal/get_post_item_for_authorization.js";
import {maxChannelContributionCount} from "~/server/forum/data/max_channel_contribution_count.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/server/helpers/node/is_test_node_env_or_admin_scenarios_script.js";
import {getNotificationPostContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {isAccountMemberOfSpace} from "~/server/spaces/spaces_actions.js";
import {
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimePutItemEvent,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, PostDraftId, PostId, SpaceId} from "~/shared/id/types/id_types.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

/**
 * Create a new post by the current account in the provided channel.
 *
 * If we're creating a post from a draft then a `draftId` parameter should be
 * provided so we can delete the draft.
 */
export async function createPost(
    context: ServerAccountActionContext,
    {
        id: postId = generateId<PostId>(),
        channelId,
        draftId = null,
        content,
        createdTimeZone,
        consistency,
        overrideCreatedTimeForTest,
    }: {
        id?: PostId;
        channelId: ChannelId;
        draftId?: PostDraftId | null;
        content: PostContent;
        createdTimeZone: TimeZone;
        consistency?: DynamoCacheReadConsistency;
        overrideCreatedTimeForTest?: Date;
    },
): Promise<{
    id: PostId;
    spaceId: SpaceId;
    createdTime: Date;
    createdTimeZone: TimeZone;
    channelName: string;
    getDynamoGeneralRealtimeEventTransaction: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<DynamoGeneralRealtimeEvent<PostModel>>>;
}> {
    // You can only manually set a created time when building scenarios or
    // in tests.
    if (overrideCreatedTimeForTest) {
        assert(isTestNodeEnvOrAdminScenariosScript);
    }

    const {spaceId, channelName} = await authorizeChannelAccess(context, channelId, "Edit", {
        consistency,
    });

    const mentionCountByAccountId = getMentionCountByAccountIdInContent(content);

    const postItem: PostAttributesItem = {
        partitionType: "Post",
        sortRangeType: "Attributes",
        postId,
        spaceId,
        channelId,
        createdTime:
            overrideCreatedTimeForTest ??
            // NOTE(calebmer): Our tests override `Date.now()` to mock a fake time. So use
            // this slightly awkward form to let tests mock different times for post
            // creation.
            new Date(Date.now()),
        createdTimeZone,
        authorId: context.actor.getPossiblyBotAccountId(),
        content,
        contentUpdate: null,
        commentsSummary: {
            nextCommentIndex: 0,
            commentCountByAuthorId: new Map(),
            mentionCountByAccountId,
        },
        reactions: new ReactionSet(emptyMap),
    };

    // Add our new post to the authorization cache BEFORE we create the post. That
    // way when we attach files with `attachFileFromAttachment()` they'll read the
    // post from this cache and won't throw a not found error.
    PostItemAuthorizationCache.set(context, "Strong", postId, postItem);

    const fileIds = getPostContentFileIds(postItem.content);

    // Make sure to attach all files to the post. So when someone else sees the
    // post they can load the files.
    await runAllPromises(
        mapIterable(fileIds, async fileId => {
            if (draftId === null) {
                throw new FailedPreconditionError("Must create post from draft to attach files");
            }

            await attachFileFromAttachment(context, postItem.spaceId, fileId, {
                from: FilePostAuthorizer.bind({
                    type: "PostDraft",
                    accountId: postItem.authorId,
                    draftId,
                }),
                to: FilePostAuthorizer.bind({
                    type: "Post",
                    postId,
                }),
            });
        }),
    );

    let result: {
        getEvent: (
            context: ServerActionContext,
        ) => Promise<DynamoGeneralRealtimePutItemEvent<PostModel>>;
    };

    if (fileIds.size === 0) {
        result = await ForumRealtimeTable.createItem(context, postItem);
    } else {
        const {transactionEntry, getEvent} =
            ForumRealtimeTable.transactionCreateItemWithEvent(postItem);

        result = {getEvent};

        await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
            transactionEntry,

            // We create the `PostFiles` item in a transaction instead of asynchronously
            // with `context.process.waitUntil()` because we want the `PostFiles` realtime
            // event to be applied atomically to clients alongside the create post realtime
            // event. Otherwise `context.process.waitUntil()` would be fine. It's not
            // critical to write this item so it's a bit of a bummer we double our DynamoDB
            // WCU cost for posts with files.
            ForumRealtimeTable.transactionDangerouslyCreateItemWithoutExistenceConditionCheck({
                partitionType: "Channel",
                sortRangeType: "PostFiles",
                channelId,
                postCreatedTime: postItem.createdTime,
                postId,
                spaceId: postItem.spaceId,
                fileIds,
            }),
        ]);
    }

    afterCreatePost(context, {
        spaceId,
        channelId,
        postId,
        postItem,
        content,
        draftId,
    });

    return {
        id: postId,
        spaceId,
        createdTime: postItem.createdTime,
        createdTimeZone: postItem.createdTimeZone,
        channelName,
        getDynamoGeneralRealtimeEventTransaction: async context => [await result.getEvent(context)],
    };
}

function afterCreatePost(
    originalContext: ServerAccountActionContext,
    {
        spaceId,
        channelId,
        postId,
        postItem,
        content,
        draftId,
    }: {
        spaceId: SpaceId;
        channelId: ChannelId;
        postId: PostId;
        postItem: PostAttributesItem;
        content: PostContent;
        draftId: PostDraftId | null;
    },
) {
    const context: ServerAccountActionContext =
        originalContext.dynamo.unexpectStrongReadConsistency();

    // TODO(calebmer): If the Node.js process crashes between the DynamoDB write
    // creating the post and this code, we won't show the newly created post in the
    // home feed! Which is pretty bad.
    //
    // I think we should probably move all this after-write logic to DynamoDB
    // streams for reliability. We should make all this after-write logic
    // idempotent and retry until the DynamoDB stream event is processed. Not just
    // here but in `createPostComment()` and `sendChatMessage()` and
    // `createChannel()`. Really anywhere that schedules some
    // `context.process.waitUntil()` work after a write that we want done reliably.
    context.process.waitUntil(async () => {
        await addFeedCandidateEntry(context, postItem.spaceId, {
            type: "Post",
            postId,
            channelId: postItem.channelId,
            authorId: postItem.authorId,
            createdTime: postItem.createdTime,
        });
    });

    // We don't delete our post draft in a transaction with post creation.
    // It's ok if we don't successfully delete the draft. It'll stay in the user's
    // draft list which is a glitch but it's fine if the glitch happens every 1 in
    // 1 million times a post is created.
    //
    // We also make a best effort to detach files. There may be race conditions
    // which prevent us from detaching all files. For example,
    // `getPostDraftFileAttachments()` is run with eventual consistency so may not
    // return a file attached a second ago. When we implement our file garbage
    // collector it'll be able to fully cleanup files from deleted drafts. (As of
    // 2024-10-30 we haven't implemented the file garbage collector. When we add a
    // file garbage collector, actually maybe it doesn't make sense to call
    // `detachFile()` here. The garbage collector will collect anyway.)
    if (draftId !== null) {
        context.process.waitUntil(async () => {
            const [, fileIds] = await runAllPromises([
                ForumTable.deleteItemWithKeyIfExists(context, {
                    partitionType: "Account",
                    sortRangeType: "PostDraft",
                    spaceId: postItem.spaceId,
                    accountId: postItem.authorId,
                    draftId,
                }),
                getPostDraftFileAttachments(
                    context,
                    postItem.spaceId,
                    postItem.authorId,
                    draftId,
                    FilePostAuthorizer,
                ),
            ]);

            // Must run after the post draft has been successfully deleted. We don't want
            // to delete attachments until after we know for certain the post draft has
            // been deleted.
            await runAllPromises(
                fileIds.map(fileId =>
                    detachFile(
                        context,
                        postItem.spaceId,
                        fileId,
                        FilePostAuthorizer.bind({
                            type: "PostDraft",
                            accountId: postItem.authorId,
                            draftId,
                        }),
                    ),
                ),
            );
        });
    }

    // When a post is created, update the contributors map. It's ok to do this in
    // `context.process.waitUntil()`. It's fine if `AppService` crashes and we
    // don't record the contribution.
    context.process.waitUntil(async () => {
        let oldContributionCount = 0;
        let newContributionCount = 0;

        await ForumRealtimeTable.updateItem(
            context,
            {partitionType: "Channel", sortRangeType: "Contributors", channelId},
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
                    contributorsItem.contributionCountByAccountId.get(
                        context.actor.getPossiblyBotAccountId(),
                    ) ?? 0;

                newContributionCount = Math.min(
                    oldContributionCount + 1,
                    maxChannelContributionCount,
                );

                // Optimization: If this account has already reached the max contribution count
                // then don't increment their contributions anymore.
                if (oldContributionCount === newContributionCount) {
                    return contributorsItem;
                }

                const newContributionCountByAccountId = new Map(
                    contributorsItem.contributionCountByAccountId,
                );

                newContributionCountByAccountId.set(
                    context.actor.getPossiblyBotAccountId(),
                    newContributionCount,
                );

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
            (oldContributionCount === 0 || newContributionCount === maxChannelContributionCount)
        ) {
            context.jobs.send({
                type: "IndexSearchEntity",
                spaceId,
                update: {
                    type: "Channel",
                    channelId,
                    updatedTraits: {type: "Some", traits: []},
                },
            });
        }
    });

    const mentionedAccountIds = getMentionedAccountIdsInContent(content);
    const contentSnippet = getNotificationPostContentSnippet(content);

    context.jobs.send({
        type: "NotificationEvent",
        event: {
            type: "CreatePost",
            id: generateChronologicalId(),
            spaceId,
            channelId: postItem.channelId,
            postId,
            createdTime: postItem.createdTime,
            authorId: postItem.authorId,
            mentionedAccountIds,
            isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
            contentSnippet,
        },
    });

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Post",
            postId,
            // Nothing depends on this entity when it's created. Don't bother trying to
            // reindex dependencies.
            updatedTraits: {type: "None"},
        },
    });

    // Posting in a channel accrues affinity points to the channel the post was
    // made in. Choosing a channel to post in probably means the channel is
    // relevant to you.
    //
    // We don't give posts themselves affinity points. That's because posts are
    // fairly short lived (a couple days). However, we give channels affinity
    // points so you could quickly jump to a channel if you're looking for a
    // certain post inside the channel.
    //
    // Importantly, bots do not accrue affinity points.
    if (context.actor.type !== "Bot") {
        context.process.waitUntil(
            markSearchAffinityEntityInteraction(
                context as ServerSessionActionContext | ServerImpersonatedAccountActionContext,
                {
                    spaceId,
                    entityId: `Channel:${channelId}`,
                    interaction: {type: "MediumIntentUpdate"},
                },
            ),
        );

        // Increase affinity points for all mentioned accounts with a high intent
        // update since the user clearly wants the attention of the mentioned accounts.
        //
        // (If a mentioned account doesn't have access to this message should that
        // still be a high intent update? For now we say yes since the user is
        // explicitly choosing to reference them.)
        for (const mentionedAccountId of mentionedAccountIds) {
            context.process.waitUntil(async () => {
                if (await isAccountMemberOfSpace(context, spaceId, mentionedAccountId)) {
                    await markSearchAffinityEntityInteraction(
                        context as
                            | ServerSessionActionContext
                            | ServerImpersonatedAccountActionContext,
                        {
                            spaceId,
                            entityId: `Account:${mentionedAccountId}`,
                            interaction: {type: "HighIntentUpdate"},
                        },
                    );
                }
            });
        }
    }
}
