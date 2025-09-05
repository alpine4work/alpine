import {getChatAccountIdsForBotScope} from "~/server/chat/data/chat_actions.js";
import {ChatInjection} from "~/server/context/injection_context_module.js";

export const chatInjection: ChatInjection = {
    getChatAccountIdsForBotScope,
};
