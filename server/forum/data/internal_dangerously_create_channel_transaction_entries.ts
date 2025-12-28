import {ServerActionContext} from "~/server/context/server_action_context.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {AccountId, ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContent, emptyMessageContent} from "~/shared/messaging/message_content_schema.js";

/**
 * Dangerous since we create a channel item for `channelId` without checking whether a
 * channel with that `ChannelId` already exists!
 */
export function internalDangerouslyCreateChannelTransactionEntries(
    context: ServerActionContext,
    {
        ownerAccountId,
        spaceId,
        channelId,
        channelName,
        channelDescription = emptyMessageContent,
        createdTime,
    }: {
        ownerAccountId: AccountId;
        spaceId: SpaceId;
        channelId: ChannelId;
        channelName: string;
        channelDescription?: MessageContent;
        createdTime: Date;
    },
) {
    return [
        // We use this when creating an alpha space. So it's ok that we don't send a
        // realtime event since there'll be no one around to subscribe to the event.
        ForumRealtimeTable.transactionDangerouslyCreateItemWithoutExistenceConditionCheckAndWithoutEvent(
            {
                partitionType: "Channel",
                sortRangeType: "Attributes",
                channelId,
                spaceId,
                createdTime,
                creatorId: ownerAccountId,
                name: channelName,
                description: channelDescription,
                accessPolicy: {
                    accountGrantById: new Map([[ownerAccountId, {level: "Manage", generation: 0}]]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
                // We haven't actually added a feed candidate entry for this channel but we
                // think it'd be weird if you unshared then re-shared this initial channel for
                // the space to get a feed entry.
                hasAddedFeedCandidateEntry: true,
            },
            {
                onAfterTransactionExecutedSuccessfully: () => {
                    context.jobs.send({
                        type: "IndexSearchEntity",
                        spaceId,
                        update: {
                            type: "Channel",
                            channelId,
                            // Nothing depends on this entity when it's created. Don't bother trying to
                            // reindex dependencies.
                            updatedTraits: {type: "None"},
                        },
                    });
                },
            },
        ),
    ];
}
