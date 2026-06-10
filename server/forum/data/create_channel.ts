import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {addFeedAccountCandidateEntry, addFeedCandidateEntry} from "~/server/feed/feed_actions.js";
import {
    ChannelAttributesItem,
    ForumRealtimeTable,
} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ForumTable} from "~/server/forum/data/internal/forum_table.js";
import {ChannelPreviewItemAuthorizationCache} from "~/server/forum/data/internal/get_channel_preview_item_for_authorization.js";
import {RynamoTableSchema} from "~/server/rynamo/rynamo_table_schema.js";
import {markSearchAffinityEntityInteraction} from "~/server/search/data/table/search_entity_actions.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {getSiteIdFromAccessPolicyIfExists} from "~/shared/access/get_site_id_from_access_policy_if_exists.js";
import {CreateOrUpdateAccessPolicy} from "~/shared/access/model/create_or_update_access_policy_schema.js";
import {MessageContent, emptyMessageContent} from "~/shared/content/message_content_schema.js";
import {RynamoEvent, RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

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
            type: "Local",
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
        accessPolicy?: CreateOrUpdateAccessPolicy;
    },
): Promise<{
    id: ChannelId;
    createdTime: Date;
    getRynamoItem: (context: ServerActionContext) => Promise<RynamoItem<ChannelModel>>;
    getRynamoEventsForSite: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SitePreviewModel | SiteEntryModel>>>;
}> {
    await authorizeSpaceAccess(context, spaceId);

    const {resolvedAccessPolicy, transactionEntries} = await validateAccessPolicyUpdateForServer(
        context,
        spaceId,
        `Channel:${channelId}`,
        null,
        accessPolicy,
    );

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
        hasAddedFeedCandidateEntry: !!resolvedAccessPolicy.defaultGrant,
    };

    const {transactionEntry, getEvent} =
        ForumRealtimeTable.transactionCreateItemWithEvent(channelItem);

    await RynamoTableSchema.executeTransaction(context, [
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
                accountIdsWithGrant: Array.from(resolvedAccessPolicy.accountGrantById.keys()),
            },
        ),
        // Automatically subscribe the channel creator to the channel they've just created.
        ForumTable.transactionCreateOrReplaceItem({
            partitionType: "Channel",
            sortRangeType: "Subscription",
            channelId,
            accountId: context.actor.getAccountId(),
            createdTime: channelItem.createdTime,
        }),
        ...transactionEntries.map(entry => entry.transactionEntry),
    ]);

    // Future `authorizeChannelAccess()` calls in the request should not need to load
    // the channel. This optimization kicks in for the create channel Remix route.
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
        // If we're creating a private channel then only add an entry to the creator
        // account's personal feed.
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
            // Nothing depends on this entity when it's created. Don't bother trying to reindex
            // dependencies.
            updatedTraits: {type: "None"},
        },
    });

    context.process.waitUntil(
        markSearchAffinityEntityInteraction(context, {
            spaceId,
            entityId: `Channel:${channelItem.channelId}`,
            interaction: {type: "HighIntentUpdate"},
            siteId: getSiteIdFromAccessPolicyIfExists(accessPolicy),
        }),
    );

    return {
        id: channelItem.channelId,
        createdTime: channelItem.createdTime,
        getRynamoItem: async context => {
            const {item} = await getEvent(context);
            return item;
        },
        getRynamoEventsForSite: async context =>
            await runAllPromises(transactionEntries.map(entry => entry.getEvent(context))),
    };
}
