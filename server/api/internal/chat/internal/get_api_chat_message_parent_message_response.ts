import {intoApiMessageContentPayloadParent} from "~/server/api/internal/shared/into_api_message_content_payload_parent.js";
import {getChatMessageParentContent} from "~/server/chat/data/chat_actions.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageContentPayloadParent} from "~/shared/messaging/message_schema.js";

export function getApiChatMessageParentMessageResponse(
    context: ServerBotActionContext,
    spaceId: SpaceId,
    chatId: ChatId,
) {
    return async function (parent: MessageContentPayloadParent) {
        assert(parent.type !== "PostRange");

        const parentContent = await getChatMessageParentContent(context, chatId, {
            parent,
            consistency: "StrongWithinCache",
        });
        return intoApiMessageContentPayloadParent(context, spaceId, {
            ...parent,
            content: parentContent.content,
            authorId: parentContent.authorId,
        });
    };
}
