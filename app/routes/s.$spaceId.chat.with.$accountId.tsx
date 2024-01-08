import {loader as actualLoader} from "~/app/routes/s.$spaceId.chat.$chatId.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/chat_table.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * This route allows you to specify the `AccountId` you want to chat with in
 * the URL in case you don't know the `ChatId`.
 */
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
