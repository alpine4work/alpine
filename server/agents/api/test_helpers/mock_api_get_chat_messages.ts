import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {ApiMessage} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

export function mockApiGetChatMessages(
    api: ApiClientMock,
    {
        spaceId,
        chatId,
        from,
        totalMessageCount,
        limit,
        cursor,
        createMessage,
    }: {
        spaceId: SpaceId;
        chatId: ChatId;
        from?: "Start" | "End";
        totalMessageCount: number;
        limit: number;
        cursor?: number;
        createMessage: (index: number) => ApiMessage;
    },
) {
    switch (from) {
        case undefined:
        case "Start": {
            let startIndex = (cursor ?? -1) + 1;
            startIndex = Math.max(startIndex, 0);

            let endIndex = startIndex + limit - 1;
            endIndex = Math.min(endIndex, totalMessageCount - 1);

            api.mockGet("/chats/{id}/messages", {
                params: {
                    path: {id: chatId},
                    query: {from, limit, cursor},
                },
                data: {
                    spaceId,
                    totalMessageCount,
                    nextCursor: endIndex !== totalMessageCount - 1 ? endIndex : null,
                    messages: createArrayWithLength(Math.max(endIndex - startIndex + 1, 0), index =>
                        createMessage(startIndex + index),
                    ),
                },
            });
            break;
        }
        case "End": {
            let endIndex = (cursor ?? totalMessageCount) - 1;
            endIndex = Math.min(endIndex, totalMessageCount - 1);

            let startIndex = endIndex - limit + 1;
            startIndex = Math.max(startIndex, 0);

            api.mockGet("/chats/{id}/messages", {
                params: {
                    path: {id: chatId},
                    query: {from, limit, cursor},
                },
                data: {
                    spaceId,
                    totalMessageCount,
                    nextCursor: startIndex !== 0 ? startIndex : null,
                    messages: createArrayWithLength(Math.max(endIndex - startIndex + 1, 0), index =>
                        createMessage(startIndex + index),
                    ),
                },
            });
            break;
        }
        default:
            throw exhaustive(from);
    }
}
