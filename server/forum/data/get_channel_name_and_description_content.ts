import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelItemAccess} from "~/server/forum/data/internal/authorize_channel_item_access.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {ChannelPreviewItemAuthorizationCache} from "~/server/forum/data/internal/get_channel_preview_item_for_authorization.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {createChannelNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {AccountId, ChannelId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Get the channel name and description content without references. Used for
 * building a search entity which will load content references on its own in a way
 * that tracks dependencies.
 */
export async function getChannelNameAndDescriptionContent(
    context: ServerActionContext,
    channelId: ChannelId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    spaceId: SpaceId;
    version: number;
    name: string;
    description: MessageContent;
    createdTime: Date;
    creatorId: AccountId | null;
    accessPolicy: AccessPolicy;
}> {
    const channelItem = await getChannelNameAndDescriptionContentIfExists(context, channelId, {
        consistency,
    });
    if (!channelItem) throw createChannelNotFoundError(channelId);

    return channelItem;
}

export async function getChannelNameAndDescriptionContentIfExists(
    context: ServerActionContext,
    channelId: ChannelId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<{
    spaceId: SpaceId;
    version: number;
    name: string;
    description: MessageContent;
    createdTime: Date;
    creatorId: AccountId | null;
    accessPolicy: AccessPolicy;
} | null> {
    const channelItemPromise = ForumRealtimeTable.getItemIfExists(
        context,
        {
            partitionType: "Channel",
            sortRangeType: "Attributes",
            channelId,
        },
        {consistency},
    );

    // Save the channel to our authorization cache in case we need it later.
    ChannelPreviewItemAuthorizationCache.set(context, consistency, channelId, channelItemPromise);

    const channelItem = await channelItemPromise;

    if (!channelItem) return null;

    await authorizeChannelItemAccess(context, channelItem, "View", {consistency});

    return {
        spaceId: channelItem.spaceId,
        version: channelItem.updateLockVersion ?? 0,
        name: channelItem.name,
        description: channelItem.description,
        createdTime: channelItem.createdTime,
        creatorId: channelItem.creator.accountId,
        accessPolicy: channelItem.accessPolicy,
    };
}
