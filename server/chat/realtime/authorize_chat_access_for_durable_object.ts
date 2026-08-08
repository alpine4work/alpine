import {WorkerActionContext} from "~/server/cloudflare/context/worker_action_context.js";
import {ContextCache} from "~/shared/context/cache_context_module.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {authorizeChatAccess} from "~/shared/rpc/chat_rpc_definitions.js";

const ChatAccessCache = new ContextCache<ChatId, {spaceId: SpaceId}>({
    whenActorChanges: "SafelyReset",
});

export function authorizeChatAccessForDurableObject(context: WorkerActionContext, chatId: ChatId) {
    // Authorize chat access once per action then cache the result.
    return ChatAccessCache.get(context, chatId, () => {
        return authorizeChatAccess(context, {chatId});
    });
}
