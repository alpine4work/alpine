import {
    deserializeAccountIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {loader as actualLoader} from "~/app/routes/_space.chat.$chatId._index.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/get_or_create_chat_for_accounts.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

/**
 * This route allows you to specify the `AccountId` you want to chat with in the
 * URL in case you don't know the `ChatId`.
 */
// NOTE(calebmer): Should this redirect to the `/chat/$chatId` route? All the "copy
// link" actions in this route currently take you to `/chat/$chatId`. Or should
// `/chat/$chatId` for a 1:1 chat redirect you to `/chat/with/$accountId`? Ideally
// we pick one canonical URL for the chat and route users there.
//
// Redirecting 1:1 chat URLs like `/chat/$chatId` to `/chat/with/$accountId` is a
// good solution since that `with/$accountId` URL is shareable with other users but
// the `$chatId` URL is not.
export async function loader({context, params, ...loaderArgs}: LoaderArgs) {
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const otherAccountId = deserializeAccountIdForLoader(params.accountId);

    const chatId = await getOrCreateChatForAccounts(
        (await context.actor.authenticate()).actor.authorizeSession(),
        {
            spaceId,
            otherAccountIds: [otherAccountId],
        },
    );

    return await actualLoader({
        ...loaderArgs,
        context,
        params: {spaceId, chatId},
    });
}

export {meta, default} from "~/app/routes/_space.chat.$chatId._index.js";
