import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";

export function mockApiGetChat(
    api: ApiClientMock,
    {spaceId, chatId, name = "Test Chat"}: {spaceId: SpaceId; chatId: ChatId; name?: string},
) {
    api.mockGet(
        "/chats/{id}",
        {
            data: {
                spaceId,
                chat: {
                    type: "Room",
                    id: chatId,
                    name,
                },
            },
        },
        {path: {id: chatId}},
    );
}
