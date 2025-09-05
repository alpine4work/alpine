import {ForumInjection} from "~/server/context/injection_context_module.js";
import {
    authorizeChannelAccessIfPossible,
    getChannelAndMetadataIfPossible,
    getPostAccessPolicyForBotScope,
    getPostIfPossible,
    isSubscribedToChannel,
} from "~/server/forum/data/forum_actions.js";

export const forumInjection: ForumInjection = {
    authorizeChannelAccessIfPossible,
    getChannelAndMetadataIfPossible,
    isSubscribedToChannel,
    getPostIfPossible,
    getPostAccessPolicyForBotScope,
};
