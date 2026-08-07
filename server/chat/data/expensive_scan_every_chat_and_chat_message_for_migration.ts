import {ChatTable} from "~/server/chat/data/internal/chat_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Scan every document and document comment in our database. Use when migrating
 * data.
 */
export async function* expensiveScanEveryChatAndChatMessageForMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
): AsyncIterableIterator<
    | {type: "Chat"; spaceId: SpaceId; chatId: ChatId}
    | {
          type: "ChatMessage";
          getSpaceId: () => Promise<SpaceId>;
          chatId: ChatId;
          messageIndex: number;
      }
> {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    const spaceIdByChatId = new Map<ChatId, Promise<SpaceId>>();

    for await (const item of ChatTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: [
            {partitionType: "Chat", sortRangeType: "Attributes"},
            {partitionType: "Chat", sortRangeType: "Messages"},
        ],
    })) {
        if (item.sortRangeType === "Attributes") {
            yield {type: "Chat", spaceId: item.spaceId, chatId: item.chatId};
        } else if (item.sortRangeType === "Messages") {
            yield {
                type: "ChatMessage",
                getSpaceId: () =>
                    getOrSetDefaultMapValue(spaceIdByChatId, item.chatId, async () => {
                        const chatItem = await ChatTable.getPartialItem(
                            context,
                            {
                                partitionType: "Chat",
                                sortRangeType: "Attributes",
                                chatId: item.chatId,
                            },
                            {attributes: ["spaceId"]},
                        );
                        return chatItem.spaceId;
                    }),
                chatId: item.chatId,
                messageIndex: item.messageIndex,
            };
        }
    }
}
