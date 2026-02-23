import {getChatAccountIdsForBotScope} from "~/server/chat/data/get_chat_account_ids_for_bot_scope.js";
import {ChatInjection} from "~/server/context/injection_context_module.js";

export const chatInjection: ChatInjection = {
    getChatAccountIdsForBotScope,
};
