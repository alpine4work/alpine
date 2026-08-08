import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelItemAccess} from "~/server/forum/data/internal/authorize_channel_item_access.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {createChannelNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Updates the description of the channel.
 */
export async function updateChannelDescription(
    context: ServerActionContext,
    {
        channelId,
        description,
        consistency,
    }: {
        channelId: ChannelId;
        description: MessageContent;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    getRynamoEvents: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<ChannelModel>>>;
}> {
    let spaceId: SpaceId | null = null;

    const result = await ForumRealtimeTable.updateItem(
        context,
        {partitionType: "Channel", sortRangeType: "Attributes", channelId},
        async channelItem => {
            if (!channelItem) throw createChannelNotFoundError(channelId);
            spaceId = channelItem.spaceId;

            await authorizeChannelItemAccess(context, channelItem, "Manage");

            return channelItem.update({description});
        },
        {consistency},
    );

    assert(spaceId);

    context.jobs.send({
        type: "IndexSearchEntity",
        spaceId,
        update: {
            type: "Channel",
            channelId,
            updatedTraits: {type: "Some", traits: []},
        },
    });

    return {
        getRynamoEvents: async context => [await result.getEvent(context)],
    };
}
