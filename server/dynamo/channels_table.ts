import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {getDynamoSeedConstants} from "~/server/dynamo/dynamo_seed_constants";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table";
import {ChannelModel} from "~/shared/channels/channel_model";
import {assert} from "~/shared/helpers/control/assert";
import {generateId} from "~/shared/id/id";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Schema} from "~/shared/schema/schema";

const ChannelsTable = DynamoTableSchema.new({
    name: "Channels",
    partitions: {
        Channel: {
            partitionKeyAttributes: {
                channelId: DynamoKeyAttributeSchema.id<ChannelId>(),
            },
            sortRanges: {
                Attributes: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),

                        /** When was this channel created? */
                        createdTime: Schema.date,

                        /** The name of this channel. */
                        name: LabelStringSchema,
                    }),
                },
            },
        },
    },
});

type ChannelAttributesItem = DynamoTableItemType<typeof ChannelsTable, "Channel", "Attributes">;

export async function seedTestChannels(context: DynamoContext) {
    assert(process.env.NODE_ENV !== "production");
    const {testChannelId, defaultSpaceId} = getDynamoSeedConstants();

    await ChannelsTable.createItemIfNoneExists(context, {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId: testChannelId,
        spaceId: defaultSpaceId,
        createdTime: new Date(),
        name: "Test",
    });
}

/**
 * Create a new channel.
 */
export async function createChannel(
    context: RequestContext,
    {spaceId, name}: {spaceId: SpaceId; name: string},
): Promise<ChannelModel> {
    await authorizeSpaceAccess(context, spaceId);

    const channelItem: ChannelAttributesItem = {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId: generateId(),
        spaceId,
        createdTime: new Date(),
        name,
    };

    await ChannelsTable.createItem(context, channelItem);
    return createChannelModelFromItem(channelItem);
}

/**
 * Gets the channel object with the provided ID. Returns null if the channel
 * doesn't exist and throws an error if the channel exists but you don't have
 * access to the channel.
 */
export async function getChannel(
    context: RequestContext,
    id: ChannelId,
): Promise<ChannelModel | null> {
    const channelItem = await ChannelsTable.getItem(context, {
        partitionType: "Channel",
        sortRangeType: "Attributes",
        channelId: id,
    });
    if (!channelItem) return null;

    await authorizeSpaceAccess(context, channelItem.spaceId);
    return createChannelModelFromItem(channelItem);
}

function createChannelModelFromItem(channelItem: ChannelAttributesItem): ChannelModel {
    return new ChannelModel({
        id: channelItem.channelId,
        spaceId: channelItem.spaceId,
        createdTime: channelItem.createdTime,
        name: channelItem.name,
    });
}
