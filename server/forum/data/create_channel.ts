import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {addFeedAccountCandidateEntry, addFeedCandidateEntry} from "~/server/feed/feed_actions.js";
import {
    ChannelAttributesItem,
    ForumRealtimeTable,
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ForumTable} from "~/server/forum/data/internal/forum_table.js";
import {ChannelPreviewItemAuthorizationCache} from "~/server/forum/data/internal/get_channel_preview_item_for_authorization.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_actions.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContent, emptyMessageContent} from "~/shared/messaging/message_content_schema.js";

/**
 * Create a new channel.
 */
export async function createChannel(
    context: ServerSessionActionContext,
    {
        spaceId,
        channelId = generateId<ChannelId>(),
        name,
        description = emptyMessageContent,
        accessPolicy = {
            accountGrantById: new Map([
                [context.actor.getAccountId(), {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    }: {
        spaceId: SpaceId;
        channelId?: ChannelId;
        name: string;
        description?: MessageContent;
        accessPolicy?: AccessPolicy;
    },
): Promise<{
    id: ChannelId;
    createdTime: Date;
    getDynamoGeneralRealtimeItem: (
        context: ServerActionContext,
    ) => Promise<DynamoGeneralRealtimeItem<ChannelModel>>;
}> {
    await authorizeSpaceAccess(context, spaceId);

    if (accessPolicy.urlGrant) {
        throw new InvalidArgumentError("Channels don’t currently support `urlGrant`s");
    }

    await validateAccessPolicyUpdateForServer(context, spaceId, null, accessPolicy);

    const creatorId = context.actor.getAccountId();

    const channelItem: ChannelAttributesItem = {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId,
        spaceId,
        createdTime: new Date(),
        creatorId,
        name,
        description,
        accessPolicy,
        hasAddedFeedCandidateEntry: !!accessPolicy.defaultGrant,
    };

    const {transactionEntry, getEvent} =
        ForumRealtimeTable.transactionCreateItemWithEvent(channelItem);

    await DynamoGeneralRealtimeTableSchema.executeTransaction(context, [
        transactionEntry,
        // Make sure the `Contributors` item is created at the same time as our channel
        // item.
        ForumRealtimeTable.transactionDangerouslyCreateItemWithoutExistenceConditionCheckAndWithoutEvent(
            {
                partitionType: "Channel",
                sortRangeType: "Contributors",
                channelId,
                spaceId,
                contributionCountByAccountId: new Map([[context.actor.getAccountId(), 1]]),
                accountIdsWithGrant: Array.from(channelItem.accessPolicy.accountGrantById.keys()),
            },
        ),
        // Automatically subscribe the channel creator to the channel they've just
        // created.
        ForumTable.transactionCreateOrReplaceItem({
            partitionType: "Channel",
            sortRangeType: "Subscription",
            channelId,
            accountId: context.actor.getAccountId(),
            createdTime: channelItem.createdTime,
        }),
    ]);

    // Future `authorizeChannelAccess()` calls in the request should not need to
    // load the channel. This optimization kicks in for the create channel Remix
    // route.
    ChannelPreviewItemAuthorizationCache.set(context, "Strong", channelId, channelItem);

    context.process.waitUntil(async () => {
        const entry: FeedEntry = {
            type: "Channel",
            channelId,
            sharedTime: channelItem.createdTime,
            sharerId: creatorId,
            creatorId,
            event: "Created",
        };

        // If we created a public channel then we immediately add it to the feed.
        if (channelItem.hasAddedFeedCandidateEntry) {
            await addFeedCandidateEntry(context, channelItem.spaceId, entry);
        }
        // If we're creating a private channel then only add an entry to the
        // creator account's personal feed.
        else {
            await addFeedAccountCandidateEntry(context, channelItem.spaceId, creatorId, entry);
        }
    });

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Channel",
            channelId: channelItem.channelId,
            // Nothing depends on this entity when it's created. Don't bother trying to
            // reindex dependencies.
            updatedTraits: {type: "None"},
        },
    });

    context.process.waitUntil(
        markSearchAffinityEntityInteraction(context, {
            spaceId,
            entityId: `Channel:${channelItem.channelId}`,
            interaction: {type: "HighIntentUpdate"},
        }),
    );

    return {
        id: channelItem.channelId,
        createdTime: channelItem.createdTime,
        getDynamoGeneralRealtimeItem: async context => {
            const {item} = await getEvent(context);
            return item;
        },
    };
}
