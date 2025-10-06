import {ForumInjection} from "~/server/context/injection_context_module.js";
import {authorizeChannelAccessIfPossible} from "~/server/forum/data/authorize_channel_access.js";
import {getChannelAndMetadataIfPossible} from "~/server/forum/data/get_channel_and_metadata.js";
import {getPostIfPossible} from "~/server/forum/data/get_post.js";
import {getPostAccessPolicyForBotScope} from "~/server/forum/data/get_post_acccess_policy_for_bot_scope.js";
import {isSubscribedToChannel} from "~/server/forum/data/is_subscribed_to_channel.js";

export const forumInjection: ForumInjection = {
    authorizeChannelAccessIfPossible,
    getChannelAndMetadataIfPossible,
    isSubscribedToChannel,
    getPostIfPossible,
    getPostAccessPolicyForBotScope,
};
