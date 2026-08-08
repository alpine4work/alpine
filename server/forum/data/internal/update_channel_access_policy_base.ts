import {intoEffectiveAccessPolicy} from "~/server/access/into_effective_access_policy.js";
import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {RynamoTransactionEntry} from "~/server/context/rynamo_transaction_entry.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {addFeedCandidateEntry} from "~/server/feed/feed_actions.js";
import {authorizeChannelItemAccess} from "~/server/forum/data/internal/authorize_channel_item_access.js";
import {
    ChannelAttributesItem,
    ChannelContributorsItem,
    ForumRealtimeTable,
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {ChannelContributorsModel, ChannelModel} from "~/shared/forum/channel_model.js";
import {createChannelNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ChannelId} from "~/shared/id/types/id_types.open_source.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

export async function updateChannelAccessPolicyBase(
    context: ServerSessionActionContext,
    {
        channelId,
        updateAccessPolicy,
        notification,
    }: {
        channelId: ChannelId;
        updateAccessPolicy: (accessPolicy: AccessPolicy) => CreateOrUpdateAccessPolicy;
        notification: ShareNotification | null;
    },
): Promise<{
    getRynamoEvents: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<ChannelModel | ChannelContributorsModel>>>;
    getRynamoEventsForSite: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    const currentTime = new Date();

    const {channelItem, shouldAddFeedCandidateEntry, getRynamoEvents, getRynamoEventsForSite} =
        await context.dynamo.retryTransaction(
            async (
                context,
            ): Promise<{
                channelItem: ChannelAttributesItem;
                shouldAddFeedCandidateEntry: boolean;
                getRynamoEvents: (
                    context: ServerActionContext,
                ) => Promise<ReadonlyArray<RynamoEvent<ChannelModel | ChannelContributorsModel>>>;
                getRynamoEventsForSite: (
                    context: ServerActionContext,
                ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
            }> => {
                const channelItem = await ForumRealtimeTable.getItemIfExists(context, {
                    partitionType: "Channel",
                    sortRangeType: "Attributes",
                    channelId,
                });
                if (!channelItem) throw createChannelNotFoundError(channelId);

                const oldAccessPolicy = channelItem.accessPolicy;
                const newAccessPolicy = updateAccessPolicy(oldAccessPolicy);

                const [, oldEffectiveAccessPolicy] = await runAllPromises([
                    authorizeChannelItemAccess(context, channelItem, "Manage"),
                    intoEffectiveAccessPolicy(context, oldAccessPolicy),
                ]);

                const {resolvedAccessPolicy: newResolvedAccessPolicy, transactionEntries} =
                    await validateAccessPolicyUpdateForServer(
                        context,
                        channelItem.spaceId,
                        `Channel:${channelId}`,
                        oldAccessPolicy,
                        newAccessPolicy,
                    );

                const oldHasAddedFeedCandidateEntry = channelItem.hasAddedFeedCandidateEntry;
                const newHasAddedFeedCandidateEntry =
                    oldHasAddedFeedCandidateEntry || !!newResolvedAccessPolicy.defaultGrant;

                const oldAccountIdsWithGrant = Array.from(
                    oldEffectiveAccessPolicy.accountGrantById.keys(),
                );
                const newAccountIdsWithGrant = Array.from(
                    newResolvedAccessPolicy.accountGrantById.keys(),
                );

                const updatedChannelItem = channelItem.update({
                    accessPolicy: newAccessPolicy,
                    hasAddedFeedCandidateEntry: newHasAddedFeedCandidateEntry,
                });

                // If we're adding or removing accounts to the `accessPolicy` then we also want to
                // update the `Contributors` item. The `Contributors` item includes the granted
                // `AccountId`s in the contributor list when we're out of accounts that have
                // actually contributed content.
                //
                // We do it in a transaction so that the `events` we return to the client includes
                // the updated contributors model. So we can immediately re-render the contributors
                // item with the new data.
                //
                // We also use the transactional path whenever there are site transaction entries
                // (adding/removing the entity from a site) so the site item write happens
                // atomically with the channel access policy change.
                const contributorsChanged = !isDeepEqual(
                    oldAccountIdsWithGrant,
                    newAccountIdsWithGrant,
                );

                if (!contributorsChanged && transactionEntries.length === 0) {
                    const {getEvent} = await ForumRealtimeTable.directlyUpdateItem(
                        context,
                        updatedChannelItem,
                    );

                    return {
                        channelItem,
                        shouldAddFeedCandidateEntry:
                            newHasAddedFeedCandidateEntry && !oldHasAddedFeedCandidateEntry,
                        getRynamoEvents: async (context: ServerActionContext) => [
                            await getEvent(context),
                        ],
                        getRynamoEventsForSite: async () => emptyArray,
                    };
                }

                const forumEntries: Array<{
                    transactionEntry: RynamoTransactionEntry;
                    getEvent: (
                        context: ServerActionContext,
                    ) => Promise<RynamoEvent<ChannelModel | ChannelContributorsModel>>;
                }> = [
                    ForumRealtimeTable.transactionDirectlyUpdateItemWithEvent(updatedChannelItem),
                ];

                if (contributorsChanged) {
                    const contributorsItem: DynamoItem<ChannelContributorsItem> =
                        (await ForumRealtimeTable.getItemIfExists(context, {
                            partitionType: "Channel",
                            sortRangeType: "Contributors",
                            channelId,
                        })) ??
                        DynamoItem.create({
                            partitionType: "Channel",
                            sortRangeType: "Contributors",
                            channelId,
                            spaceId: channelItem.spaceId,
                            contributionCountByAccountId: new Map(),
                            accountIdsWithGrant: emptyArray,
                        });

                    forumEntries.push(
                        ForumRealtimeTable.transactionDirectlyUpdateItemWithEvent(
                            contributorsItem.update({
                                accountIdsWithGrant: newAccountIdsWithGrant,
                            }),
                        ),
                    );
                }

                await RynamoTableSchema.executeTransaction(context, [
                    ...forumEntries.map(entry => entry.transactionEntry),
                    ...transactionEntries.map(entry => entry.transactionEntry),
                ]);

                return {
                    channelItem,
                    shouldAddFeedCandidateEntry:
                        newHasAddedFeedCandidateEntry && !oldHasAddedFeedCandidateEntry,
                    getRynamoEvents: async (context: ServerActionContext) =>
                        await runAllPromises(forumEntries.map(entry => entry.getEvent(context))),
                    getRynamoEventsForSite: async (context: ServerActionContext) =>
                        await runAllPromises(
                            transactionEntries.map(entry => entry.getEvent(context)),
                        ),
                };
            },
        );

    if (shouldAddFeedCandidateEntry) {
        context.process.waitUntil(async () => {
            await addFeedCandidateEntry(context, channelItem.spaceId, {
                type: "Channel",
                channelId,
                sharedTime: currentTime,
                sharerId: context.actor.getAccountId(),
                creatorId: channelItem.creator.accountId,
                event: "SharedWithAccessPolicyDefaultGrant",
            });
        });
    }

    // TODO(calebmer, #security): Send `IndexSearchEntity` job from DynamoDB stream.
    // Right now we can't guarantee indexing after a DynamoDB update. Say we make a
    // DynamoDB write and then before we're able to send `IndexSearchEntity` to SQS the
    // EC2 instance crashes! If the DynamoDB update changed the channel's permissions
    // then we won't propagate the permission updates to the channel's posts and post
    // comments in OpenSearch. Which is very bad!
    //
    // This is a problem for all `IndexSearchEntity` jobs after an access policy
    // update. Arbitrarily leaving the TODO comment here.
    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId: channelItem.spaceId,
        update: {
            type: "Channel",
            channelId,
            updatedTraits: {type: "Some", traits: ["Authorization"]},
        },
    });

    if (notification) {
        context.jobs.send({
            type: "SendShareNotification",
            jobId: generateId(),
            spaceId: channelItem.spaceId,
            actorAccountId: context.actor.getAccountId(),
            entityId: `Channel:${channelId}`,
            notification,
        });
    }

    return {
        getRynamoEvents,
        getRynamoEventsForSite,
    };
}
