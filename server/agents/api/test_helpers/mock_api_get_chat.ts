import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";

export function mockApiGetChat(
    api: ApiClientMock,
    {spaceId, chatId}: {spaceId: SpaceId; chatId: ChatId},
) {
    api.mockGet(
        "/chats/{id}",
        {
            data: {
                spaceId,
                chat: {
                    type: "Room",
                    id: chatId,
                    name: "Incident Response",
                },
            },
        },
        {path: {id: chatId}},
    );
}
