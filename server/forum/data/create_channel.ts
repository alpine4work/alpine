import {validateAccessPolicyUpdateForServer} from "~/server/access/validate_access_policy_update_for_server.js";
import {
    ServerAccountActionContext,
    ServerActionContext,
    ServerImpersonatedAccountActionContext,
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
import {FailedPreconditionError, PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {FeedEntry} from "~/shared/feed/feed_entry_schema.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, ChannelId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SiteEntryModel, SitePreviewModel} from "~/shared/sites/site_model.js";

/**
 * Create a new channel.
 */
export async function createChannel(
    context: ServerAccountActionContext,
    options: {
        spaceId: SpaceId;
        channelId?: ChannelId;
        creatorId?: AccountId;
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
    const {
        spaceId,
        channelId = generateId<ChannelId>(),
        name,
        description = emptyMessageContent,
    } = options;
    let {creatorId, accessPolicy} = options;

    if (
        creatorId &&
        context.actor.type !== "Bot" &&
        creatorId !== context.actor.getPossiblyBotAccountId()
    ) {
        throw new PermissionDeniedError(
            "Only bots can create channels on behalf of other accounts",
        );
    }

    if (context.actor.type === "Bot") {
        if (accessPolicy === undefined) {
            throw new FailedPreconditionError(
                "You must set the `accessPolicy` field when creating a channel from a bot context",
            );
        }
    } else {
        accessPolicy ??= {
            type: "Local",
            accountGrantById: new Map([
                [context.actor.getAccountId(), {level: "Manage", generation: 0}],
            ]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        };
    }

    creatorId ??= context.actor.getPossiblyBotAccountId();
    const creator = {
        accountId: creatorId,
        from:
            context.actor.type === "Bot" && creatorId !== context.actor.getBotAccountId()
                ? {type: "Bot" as const, accountId: context.actor.getBotAccountId()}
                : null,
    };

    await authorizeSpaceAccess(context, spaceId);

    const {resolvedAccessPolicy, transactionEntries} = await validateAccessPolicyUpdateForServer(
        context,
        spaceId,
        `Channel:${channelId}`,
        null,
        accessPolicy,
    );

    const channelItem: ChannelAttributesItem = {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId,
        spaceId,
        createdTime: new Date(),
        creator,
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
                contributionCountByAccountId: new Map([[creatorId, 1]]),
                accountIdsWithGrant: Array.from(resolvedAccessPolicy.accountGrantById.keys()),
            },
        ),
        // Automatically subscribe the channel creator to the channel they've just created.
        ForumTable.transactionCreateOrReplaceItem({
            partitionType: "Channel",
            sortRangeType: "Subscription",
            channelId,
            accountId: creatorId,
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

    // Bots do not accrue affinity points.
    if (context.actor.type !== "Bot") {
        context.process.waitUntil(
            markSearchAffinityEntityInteraction(
                context as ServerSessionActionContext | ServerImpersonatedAccountActionContext,
                {
                    spaceId,
                    entityId: `Channel:${channelItem.channelId}`,
                    interaction: {type: "HighIntentUpdate"},
                    siteId: getSiteIdFromAccessPolicyIfExists(accessPolicy),
                },
            ),
        );
    }

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
