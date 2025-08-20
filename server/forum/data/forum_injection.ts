import {ForumInjection} from "~/server/context/injection_context_module.js";
import {
    authorizeChannelAccessIfPossible,
    getChannelAndMetadataIfPossible,
    getPostIfPossible,
    isSubscribedToChannel,
} from "~/server/forum/data/forum_table.js";

export const forumInjection: ForumInjection = {
    authorizeChannelAccessIfPossible,
    getChannelAndMetadataIfPossible,
    isSubscribedToChannel,
    getPostIfPossible,
};
