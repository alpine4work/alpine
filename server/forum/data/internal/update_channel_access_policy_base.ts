import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoItem} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {addFeedCandidateEntry} from "~/server/feed/feed_actions.js";
import {authorizeChannelItemAccess} from "~/server/forum/data/internal/authorize_channel_item_access.js";
import {
    ChannelAttributesItem,
    ChannelContributorsItem,
    ForumRealtimeTable,
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ChannelContributorsModel, ChannelModel} from "~/shared/forum/channel_model.js";
import {createChannelNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId} from "~/shared/id/types/id_types.js";

export async function updateChannelAccessPolicyBase(
    context: ServerSessionActionContext,
    {
        channelId,
        updateAccessPolicy,
        notification,
    }: {
        channelId: ChannelId;
        updateAccessPolicy: (accessPolicy: AccessPolicy) => AccessPolicy;
        notification: ShareNotification | null;
    },
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (
        context: ServerActionContext,
    ) => Promise<
        ReadonlyArray<DynamoGeneralRealtimeEvent<ChannelModel | ChannelContributorsModel>>
    >;
}> {
    const currentTime = new Date();

    const {channelItem, shouldAddFeedCandidateEntry, getDynamoGeneralRealtimeEventTransaction} =
        await context.dynamo.retryTransaction(
            async (
                context,
            ): Promise<{
                channelItem: ChannelAttributesItem;
                shouldAddFeedCandidateEntry: boolean;
                getDynamoGeneralRealtimeEventTransaction: (
                    context: ServerActionContext,
                ) => Promise<
                    ReadonlyArray<
                        DynamoGeneralRealtimeEvent<ChannelModel | ChannelContributorsModel>
                    >
                >;
            }> => {
                const channelItem = await ForumRealtimeTable.getItemIfExists(context, {
                    partitionType: "Channel",
                    sortRangeType: "Attributes",
                    channelId,
                });
                if (!channelItem) throw createChannelNotFoundError(channelId);

                await authorizeChannelItemAccess(context, channelItem, "Manage");

                const oldAccessPolicy = channelItem.accessPolicy;
                const newAccessPolicy = updateAccessPolicy(oldAccessPolicy);

                await validateAccessPolicyUpdateForServer(
                    context,
                    channelItem.spaceId,
                    oldAccessPolicy,
                    newAccessPolicy,
                );

                const oldHasAddedFeedCandidateEntry = channelItem.hasAddedFeedCandidateEntry;
                const newHasAddedFeedCandidateEntry =
                    oldHasAddedFeedCandidateEntry || !!newAccessPolicy.defaultGrant;

                const oldAccountIdsWithGrant = Array.from(oldAccessPolicy.accountGrantById.keys());
                const newAccountIdsWithGrant = Array.from(newAccessPolicy.accountGrantById.keys());

                // If we're adding or removing accounts to the `accessPolicy` then we also want
                // to update the `Contributors` item. The `Contributors` item includes the
                // granted `AccountId`s in the contributor list when we're out of accounts that
                // have actually contributed content.
                //
                // We do it in a transaction so that the `eventTransaction` we return to the
                // client includes the updated contributors model. So we can immediately
                // re-render the contributors item with the new data.
                if (isDeepEqual(oldAccountIdsWithGrant, newAccountIdsWithGrant)) {
                    const {getEvent} = await ForumRealtimeTable.directlyUpdateItem(
                        context,
                        channelItem.update({
                            accessPolicy: newAccessPolicy,
                            hasAddedFeedCandidateEntry: newHasAddedFeedCandidateEntry,
                        }),
                    );

                    return {
                        channelItem,
                        shouldAddFeedCandidateEntry:
                            newHasAddedFeedCandidateEntry && !oldHasAddedFeedCandidateEntry,
                        getDynamoGeneralRealtimeEventTransaction: async context => [
                            await getEvent(context),
                        ],
                    };
                } else {
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

                    const {getEventTransaction} =
                        await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
                            ForumRealtimeTable.transactionDirectlyUpdateItem(
                                channelItem.update({
                                    accessPolicy: newAccessPolicy,
                                    hasAddedFeedCandidateEntry: newHasAddedFeedCandidateEntry,
                                }),
                            ),
                            ForumRealtimeTable.transactionDirectlyUpdateItem(
                                contributorsItem.update({
                                    accountIdsWithGrant: newAccountIdsWithGrant,
                                }),
                            ),
                        ]);

                    return {
                        channelItem,
                        shouldAddFeedCandidateEntry:
                            newHasAddedFeedCandidateEntry && !oldHasAddedFeedCandidateEntry,
                        getDynamoGeneralRealtimeEventTransaction: async context =>
                            (await getEventTransaction(
                                context,
                                ForumRealtimeTable,
                            )) as ReadonlyArray<
                                DynamoGeneralRealtimeEvent<ChannelModel | ChannelContributorsModel>
                            >,
                    };
                }
            },
        );

    if (shouldAddFeedCandidateEntry) {
        context.process.waitUntil(async () => {
            await addFeedCandidateEntry(context, channelItem.spaceId, {
                type: "Channel",
                channelId,
                sharedTime: currentTime,
                sharerId: context.actor.getAccountId(),
                creatorId: channelItem.creatorId,
                event: "SharedWithAccessPolicyDefaultGrant",
            });
        });
    }

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

    return {getDynamoGeneralRealtimeEventTransaction};
}
