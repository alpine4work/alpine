import {authorizeChatAccessIfPossible} from "~/server/chat/data/authorize_chat_access.js";
import {FileChatAuthorizer} from "~/server/chat/data/file_chat_authorizer.js";
import {getChatAccessPolicyForBotScope} from "~/server/chat/data/get_chat_access_policy_for_bot_scope.js";
import {getChatAndInitialMessagesIfPossible} from "~/server/chat/data/get_chat_and_initial_messages.js";
import {ChatInjection} from "~/server/context/injection_context_module.js";

export const chatInjection: ChatInjection = {
    getChatAccessPolicyForBotScope,
    authorizeChatAccessIfPossible,
    getChatAndInitialMessagesIfPossible,
    bindFileChatAuthorizer: (_context, target) => FileChatAuthorizer.bind(target),
};
