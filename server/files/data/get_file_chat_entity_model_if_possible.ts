import {ServerActionContext} from "~/server/context/server_action_context.js";
import {createChatNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {FileChatEntityModel} from "~/shared/chat/file_chat_entity_model_schema.js";
import {ErrorBase} from "~/shared/error/error.js";
import {Result} from "~/shared/helpers/control/result.js";
import {ChatId} from "~/shared/id/types/id_types.js";

export async function getFileChatEntityModelIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
): Promise<Result<FileChatEntityModel, ErrorBase>> {
    const result = await context.chatInjection.getChatAndInitialMessagesIfPossible({
        chatId,
        // Determined experimentally to be the maximum number of messages we display in
        // the chat preview when the preview is at third width (so a tall height) and
        // all messages are at min height.
        //
        // See the screenshot in:
        // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/5va8b8wm3f4zb003vyrqy1sty4
        messagesLimit: 11,
    });
    if (!result) return {ok: false, error: createChatNotFoundError(chatId)};
    if (!result.ok) return result;

    const {chat, initialIsSubscribed, initialMessages, initialOtherReferencedMessages} =
        result.value;

    return {
        ok: true,
        value: {
            type: "Chat",
            versions: [chat.version],
            id: chat.id,
            definition:
                chat.definition.type !== "Room"
                    ? chat.definition
                    : {
                          type: "Room",
                          name: chat.definition.name,
                          isPrivate:
                              !chat.definition.accessPolicy.defaultGrant &&
                              !chat.definition.accessPolicy.urlGrant,
                      },
            isSubscribed: initialIsSubscribed ?? false,
            messages: initialMessages,
            otherReferencedMessages: initialOtherReferencedMessages,
        },
    };
}
