import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeChannelItemAccess} from "~/server/forum/data/internal/authorize_channel_item_access.js";
import {ForumRealtimeTable} from "~/server/forum/data/internal/forum_realtime_table.js";
import {MessageContent} from "~/shared/content/message_content_schema.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {createChannelNotFoundError} from "~/shared/forum/forum_error_messages.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * Updates the name and description of the channel.
 */
export async function updateChannelNameAndDescription(
    context: ServerActionContext,
    {
        channelId,
        name,
        description,
        consistency,
    }: {
        channelId: ChannelId;
        name: string;
        description: MessageContent;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<{
    getRynamoEvents: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<ChannelModel>>>;
}> {
    // Give the user a nice error message if there was an error validating the new
    // channel name.
    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    let spaceId: SpaceId | null = null;

    const result = await ForumRealtimeTable.updateItem(
        context,
        {partitionType: "Channel", sortRangeType: "Attributes", channelId},
        async channelItem => {
            if (!channelItem) throw createChannelNotFoundError(channelId);
            spaceId = channelItem.spaceId;

            await authorizeChannelItemAccess(context, channelItem, "Manage");

            return channelItem.update({name, description});
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
            updatedTraits: {type: "Some", traits: ["Preview"]},
        },
    });

    return {
        getRynamoEvents: async context => [await result.getEvent(context)],
    };
}
