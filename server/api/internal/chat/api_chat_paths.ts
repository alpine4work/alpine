import {
    ApiOperation200JsonResponseType,
    ApiPaths,
} from "~/server/api/internal/shared/api_paths_type.js";
import {intoApiMessagePayload} from "~/server/api/internal/shared/into_api_message_payload.js";
import {getChatMessagePayload} from "~/server/chat/data/chat_actions.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.js";

export const apiChatPaths: Pick<ApiPaths, keyof ApiPaths & `/chats/${string}`> = {
    "/chats/{id}/messages/{index}": {
        get: async (context, {pathParams, searchParams}) => {
            const message = await getChatMessagePayload(context, {
                chatId: pathParams.id,
                messageIndex: pathParams.index,
                consistency: "StrongWithinCache",
            });

            const content: ApiOperation200JsonResponseType<"/chats/{id}/messages/{index}", "get"> =
                {
                    roomPath: `/chats/${pathParams.id}`,
                    index: pathParams.index,
                    createdTime: serializeDateString(message.createdTime),
                    payload: intoApiMessagePayload(message.payload),
                };

            // We want to test that response schemas are validated in a Jest unit test. So
            // allow adding a search param to trigger a response validation failure.
            if (import.meta.jest && searchParams.has("test-additional-property")) {
                (content as any).additionalProperty = searchParams.get("test-additional-property");
            }

            return {
                content,
            };
        },
    },
};
