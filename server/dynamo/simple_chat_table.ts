import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {getDynamoSeedConstants} from "~/server/dynamo/dynamo_seed_constants";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table";
import {assert} from "~/shared/helpers/control/assert";
import {SimpleChatId, SpaceId} from "~/shared/id/types/id_types";
import {Schema} from "~/shared/schema/schema";

// TODO(calebmer): This is temporary for me to test the new messaging
// functionality. It will be deleted once I am happy.
const SimpleChatTable = DynamoTableSchema.new({
    name: "SimpleChat",
    partitions: {
        SimpleChat: {
            partitionKeyAttributes: {
                simpleChatId: DynamoKeyAttributeSchema.id<SimpleChatId>(),
            },
            sortRanges: {
                Attributes: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceId: Schema.id<SpaceId>(),
                    }),
                },
            },
        },
    },
});

export async function seedTestSimpleChats(context: DynamoContext) {
    assert(process.env.NODE_ENV !== "production");
    const {testSimpleChatId, defaultSpaceId} = getDynamoSeedConstants();

    await SimpleChatTable.createItemIfNoneExists(context, {
        partitionType: "SimpleChat",
        sortRangeType: "Attributes",
        simpleChatId: testSimpleChatId,
        spaceId: defaultSpaceId,
    });
}

export async function getSimpleChat(context: RequestContext, id: SimpleChatId) {
    const simpleChatItem = await SimpleChatTable.getItem(context, {
        partitionType: "SimpleChat",
        sortRangeType: "Attributes",
        simpleChatId: id,
    });
    if (!simpleChatItem) return null;

    await authorizeSpaceAccess(context, simpleChatItem.spaceId);

    return {
        simpleChatId: simpleChatItem.simpleChatId,
        spaceId: simpleChatItem.spaceId,
    };
}
