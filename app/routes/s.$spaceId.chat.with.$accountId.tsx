import {loader as actualLoader} from "~/app/routes/s.$spaceId.chat.$chatId.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/chat_actions.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * This route allows you to specify the `AccountId` you want to chat with in
 * the URL in case you don't know the `ChatId`.
 */
// NOTE(calebmer): Should this redirect to the `/s/$spaceId/chat/$chatId`
// route? All the "copy link" actions in this route currently take you to
// `/s/$spaceId/chat/$chatId`. Or should `/s/$spaceId/chat/$chatId` for a
// 1:1 chat redirect you to `/s/$spaceId/chat/with/$accountId`? Ideally we
// pick one canonical URL for the chat and route users there.
//
// Redirecting 1:1 chat URLs like `/s/$spaceId/chat/$chatId` to
// `/s/$spaceId/chat/with/$accountId` is a good solution since that
// `with/$accountId` URL is shareable with other users but the `$chatId` URL is
// not.
export async function loader({context, params, ...loaderArgs}: LoaderArgs) {
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    const otherAccountId = Schema.id<AccountId>().deserialize(params.accountId ?? null);

    const chatId = await getOrCreateChatForAccounts(
        (await context.actor.authenticate()).actor.authorizeSession(),
        {
            spaceId,
            otherAccountIds: [otherAccountId],
        },
    );

    return actualLoader({
        ...loaderArgs,
        context,
        params: {spaceId, chatId},
    });
}

export {meta, default} from "~/app/routes/s.$spaceId.chat.$chatId.js";
