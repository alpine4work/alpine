import {unwrapAccessPolicyModelForServer} from "~/server/access/unwrap_access_policy_model_for_server.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {createFileEntitySitePreviewPrefetcher} from "~/server/files/data/internal/create_file_entity_site_preview_prefetcher.js";
import {AccessPolicyModel} from "~/shared/access/model/access_policy_model.js";
import {createChatNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {FileChatEntityModel} from "~/shared/chat/file_chat_entity_model_schema.js";
import {ErrorBase} from "~/shared/error/error.js";
import {Result} from "~/shared/helpers/control/result.js";
import {ChatId} from "~/shared/id/types/id_types.js";
import {SitePreviewModel} from "~/shared/sites/site_model.js";

export async function getFileChatEntityModelIfPossible(
    context: ServerActionContext,
    chatId: ChatId,
    options?: {siteIfAlreadyLoaded?: SitePreviewModel},
): Promise<Result<FileChatEntityModel, ErrorBase>> {
    const sitePreviewPrefetcher = createFileEntitySitePreviewPrefetcher(context, {
        siteIfAlreadyLoaded: options?.siteIfAlreadyLoaded,
    });

    const result = await context.chatInjection.getChatAndInitialMessagesIfPossible({
        chatId,
        // Determined experimentally to be the maximum number of messages we display in the
        // chat preview when the preview is at third width (so a tall height) and all
        // messages are at min height.
        //
        // See the screenshot in:
        // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/5va8b8wm3f4zb003vyrqy1sty4
        messagesLimit: 11,
        onSiteId: sitePreviewPrefetcher.onSiteId,
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
                          isPrivate: isChatRoomPrivate(chat.definition.accessPolicy),
                      },
            isSubscribed: initialIsSubscribed ?? false,
            messages: initialMessages,
            otherReferencedMessages: initialOtherReferencedMessages,
            site: await sitePreviewPrefetcher.get(),
        },
    };

    function isChatRoomPrivate(accessPolicy: AccessPolicyModel): boolean {
        const resolvedAccessPolicy = unwrapAccessPolicyModelForServer(accessPolicy);
        return !resolvedAccessPolicy.defaultGrant && !resolvedAccessPolicy.urlGrant;
    }
}
