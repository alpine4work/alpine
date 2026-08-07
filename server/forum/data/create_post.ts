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
import {getNotificationPostContentSnippet} from "~/server/notifications/core/get_notification_content_snippet.js";
import {RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {getSiteIdFromAccessPolicyIfExists} from "~/shared/access/get_site_id_from_access_policy_if_exists.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {PostContent} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.open_source.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.open_source.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    ChannelId,
    PostDraftId,
    PostId,
    SpaceId,
} from "~/shared/id/types/id_types.open_source.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

/**
 * Create a new post in the provided channel.
 *
 * Bots can pass `creatorId` to create the post on behalf of another account.
 *
 * If we're creating a post from a draft then a `draftId` parameter should be
 * provided so we can delete the draft.
 */
export async function createPost(
    context: ServerAccountActionContext,
    {
        id: postId = generateId<PostId>(),
        channelId,
        creatorId,
        draftId = null,
        content,
        createdTimeZone,
        consistency,
        overrideCreatedTimeForTest,
    }: {
        id?: PostId;
        channelId: ChannelId;
        creatorId?: AccountId;
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
    getRynamoEvents: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<PostModel>>>;
}> {
    // You can only manually set a created time when building scenarios or in tests.
    if (overrideCreatedTimeForTest) {
        assert(isTestNodeEnvOrAdminScenariosScript);
    }

    if (
        creatorId &&
        context.actor.type !== "Bot" &&
        creatorId !== context.actor.getPossiblyBotAccountId()
    ) {
        throw new PermissionDeniedError("Only bots can create posts on behalf of other accounts");
    }

    const authorId = creatorId ?? context.actor.getPossiblyBotAccountId();
    const author = {
        accountId: authorId,
        from:
            context.actor.type === "Bot" && authorId !== context.actor.getBotAccountId()
                ? {type: "Bot" as const, accountId: context.actor.getBotAccountId()}
                : null,
    };

    return await context.dynamo.retryTransaction(async context => {
        const [{spaceId, channelName, accessPolicy: channelAccessPolicy}, channelPostsItem] =
            await runAllPromises([
                authorizeChannelAccess(context, channelId, "Edit", {consistency}),
                ForumTable.getItemIfExists(
                    context,
                    {
                        partitionType: "Channel",
                        sortRangeType: "Posts",
                        channelId,
                    },
                    {consistency},
                ),
            ]);

        const mentionCountByAccountId = getMentionCountByAccountIdInContent(content);

        const postItem: PostAttributesItem = {
            partitionType: "Post",
            sortRangeType: "Attributes",
            postId,
            spaceId,
            channelId,
            createdTime: new Date(
                Math.max(
                    // Make sure posts have monotonically increasing `createdTime` by guaranteeing a
                    // post in a channel always has a `createTime` at least 1ms higher than the
                    // previous post.
                    (channelPostsItem?.lastPostCreatedTime.getTime() ?? 0) + 1,

                    overrideCreatedTimeForTest?.getTime() ??
                        // NOTE(calebmer): Our tests override `Date.now()` to mock a fake time. So use this
                        // slightly awkward form to let tests mock different times for post creation.
                        Date.now(),
                ),
            ),
            createdTimeZone,
            author,
            content,
            contentUpdate: null,
            commentsSummary: {
                nextCommentIndex: 0,
                commentCountByAuthorId: new Map(),
                mentionCountByAccountId,
            },
            reactions: new ReactionSet(emptyMap),
        };

        // Add our new post to the authorization cache BEFORE we create the post. That way
        // when we attach files with `attachFileFromAttachment()` they'll read the post
        // from this cache and won't throw a not found error.
        PostItemAuthorizationCache.set(context, "Strong", postId, postItem);

        const fileIds = getPostContentFileIds(postItem.content);

        // Make sure to attach all files to the post. So when someone else sees the post
        // they can load the files.
        await runAllPromises(
            mapIterable(fileIds, async fileId => {
                if (draftId !== null) {
                    // Move file attachment from the draft to the published post.
                    await attachFileFromAttachment(context, fileId, {
                        from: FilePostAuthorizer.bind({
                            type: "PostDraft",
                            spaceId: postItem.spaceId,
                            accountId: postItem.author.accountId,
                            draftId,
                        }),
                        to: FilePostAuthorizer.bind({
                            type: "Post",
                            postId,
                        }),
                    });
                } else if (context.actor.type === "Bot") {
                    // Bots are responsible for attaching files before calling `createPost`. The API
                    // layer handles this.
                    //
                    // TODO: we should validate that all files are attached before creating the post.
                    // To do this right we'd need attachFileFromAttachment() to cache the attachment in
                    // ContextCache so the check here is 0-cost for the API.
                } else {
                    throw new FailedPreconditionError(
                        "Must create post from draft to attach files",
                    );
                }
            }),
        );

        const {transactionEntry, getEvent} =
            ForumRealtimeTable.transactionCreateItemWithEvent(postItem);

        await RynamoTableSchema.executeTransaction(context, [
            transactionEntry,

            ForumTable.transactionDirectlyUpdateItem({
                partitionType: "Channel",
                sortRangeType: "Posts",
                channelId,
                ...channelPostsItem,
                lastPostCreatedTime: postItem.createdTime,
            }),

            // We create the `PostFiles` item in a transaction instead of asynchronously with
            // `context.process.waitUntil()` because we want the `PostFiles` realtime event to
            // be applied atomically to clients alongside the create post realtime event.
            // Otherwise `context.process.waitUntil()` would be fine. It's not critical to
            // write this item so it's a bit of a bummer we double our DynamoDB WCU cost for
            // posts with files.
            ...(fileIds.size > 0
                ? [
                      ForumRealtimeTable.transactionDangerouslyCreateItemWithoutExistenceConditionCheck(
                          {
                              partitionType: "Channel",
                              sortRangeType: "PostFiles",
                              channelId,
                              postCreatedTime: postItem.createdTime,
                              postId,
                              spaceId: postItem.spaceId,
                              fileIds,
                          },
                      ),
                  ]
                : []),
        ]);

        afterCreatePost(context, {
            spaceId,
            channelId,
            channelAccessPolicy,
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
            getRynamoEvents: async context => [await getEvent(context)],
        };
    });
}

function afterCreatePost(
    originalContext: ServerAccountActionContext,
    {
        spaceId,
        channelId,
        channelAccessPolicy,
        postId,
        postItem,
        content,
        draftId,
    }: {
        spaceId: SpaceId;
        channelId: ChannelId;
        channelAccessPolicy: AccessPolicy;
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
    // I think we should probably move all this after-write logic to DynamoDB streams
    // for reliability. We should make all this after-write logic idempotent and retry
    // until the DynamoDB stream event is processed. Not just here but in
    // `createPostComment()` and `sendChatMessage()` and `createChannel()`. Really
    // anywhere that schedules some `context.process.waitUntil()` work after a write
    // that we want done reliably.
    context.process.waitUntil(async () => {
        await addFeedCandidateEntry(context, postItem.spaceId, {
            type: "Post",
            postId,
            channelId: postItem.channelId,
            authorId: postItem.author.accountId,
            createdTime: postItem.createdTime,
        });
    });

    // We don't delete our post draft in a transaction with post creation. It's ok if
    // we don't successfully delete the draft. It'll stay in the user's draft list
    // which is a glitch but it's fine if the glitch happens every 1 in 1 million times
    // a post is created.
    //
    // We also make a best effort to detach files. There may be race conditions which
    // prevent us from detaching all files. For example,
    // `getPostDraftFileAttachments()` is run with eventual consistency so may not
    // return a file attached a second ago. When we implement our file garbage
    // collector it'll be able to fully cleanup files from deleted drafts. (As of
    // 2024-10-30 we haven't implemented the file garbage collector. When we add a file
    // garbage collector, actually maybe it doesn't make sense to call `detachFile()`
    // here. The garbage collector will collect anyway.)
    if (draftId !== null) {
        context.process.waitUntil(async () => {
            const [, fileIds] = await runAllPromises([
                ForumTable.deleteItemWithKeyIfExists(context, {
                    partitionType: "Account",
                    sortRangeType: "PostDraft",
                    spaceId: postItem.spaceId,
                    accountId: postItem.author.accountId,
                    draftId,
                }),
                getPostDraftFileAttachments(
                    context,
                    postItem.spaceId,
                    postItem.author.accountId,
                    draftId,
                    FilePostAuthorizer,
                ),
            ]);

            // Must run after the post draft has been successfully deleted. We don't want to
            // delete attachments until after we know for certain the post draft has been
            // deleted.
            await runAllPromises(
                fileIds.map(fileId =>
                    detachFile(
                        context,
                        fileId,
                        FilePostAuthorizer.bind({
                            type: "PostDraft",
                            spaceId: postItem.spaceId,
                            accountId: postItem.author.accountId,
                            draftId,
                        }),
                    ),
                ),
            );
        });
    }

    // When a post is created, update the contributors map. It's ok to do this in
    // `context.process.waitUntil()`. It's fine if `AppService` crashes and we don't
    // record the contribution.
    context.process.waitUntil(async () => {
        let oldContributionCount = 0;
        let newContributionCount = 0;

        await ForumRealtimeTable.updateItem(
            context,
            {partitionType: "Channel", sortRangeType: "Contributors", channelId},
            contributorsItem => {
                // NOTE(ifitzsimmons, 2026-07-22): We made an intentional decision to omit the bot
                // account from the contributors if it created the post on the behalf of another
                // account. The reasoning here is that the Post UX is responsible for explaining
                // that, for example, Ian is the author of the post via ChatGpt. Maybe something
                // like "Ian in Channel: ..." where the avatar is a pile and Ian's avatar is first
                // and the bot's is second.
                //
                // So if at the post level the messaging is "Ian did this, ChatGpt was involved",
                // it feels strange to give ChatGpt the same level of importance as post authors at
                // the channel-level.
                contributorsItem ??= DynamoItem.create({
                    partitionType: "Channel",
                    sortRangeType: "Contributors",
                    channelId: postItem.channelId,
                    spaceId: postItem.spaceId,
                    contributionCountByAccountId: new Map(),
                    accountIdsWithGrant: emptyArray,
                });

                oldContributionCount =
                    contributorsItem.contributionCountByAccountId.get(postItem.author.accountId) ??
                    0;

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
                    postItem.author.accountId,
                    newContributionCount,
                );

                return contributorsItem.update({
                    contributionCountByAccountId: newContributionCountByAccountId,
                });
            },
        );

        // Reindex the channel whenever someone contributes for the first time (making them
        // a minor contributor) or when someone maxes out their contribution count (making
        // them a major contributor).
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
            authorId: postItem.author.accountId,
            mentionedAccountIds,
            isContentSnippetComplete: contentSnippet.nodeSize === content.nodeSize,
            contentSnippet,
            createdTimeZone: postItem.createdTimeZone,
        },
    });

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Post",
            postId,
            // Nothing depends on this entity when it's created. Don't bother trying to reindex
            // dependencies.
            updatedTraits: {type: "None"},
        },
    });

    // Posting in a channel accrues affinity points to the channel the post was made
    // in. Choosing a channel to post in probably means the channel is relevant to you.
    //
    // We don't give posts themselves affinity points. That's because posts are fairly
    // short lived (a couple days). However, we give channels affinity points so you
    // could quickly jump to a channel if you're looking for a certain post inside the
    // channel.
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
                    siteId: getSiteIdFromAccessPolicyIfExists(channelAccessPolicy),
                },
            ),
        );

        // Increase affinity points for all mentioned accounts with a high intent update
        // since the user clearly wants the attention of the mentioned accounts.
        //
        // (If a mentioned account doesn't have access to this message should that still be
        // a high intent update? For now we say yes since the user is explicitly choosing
        // to reference them.)
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
                            // Accounts cannot live in a site.
                            siteId: null,
                        },
                    );
                }
            });
        }
    }
}
