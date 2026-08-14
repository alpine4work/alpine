import {redirect} from "@remix-run/server-runtime";
import {
    deserializeAccountIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/get_or_create_chat_for_accounts.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    const otherAccountId = deserializeAccountIdForLoader(params.accountId);

    const chatId = await getOrCreateChatForAccounts(
        (await context.actor.authenticate()).actor.authorizeSession(),
        {
            spaceId,
            otherAccountIds: [otherAccountId],
        },
    );

    return redirect(`/debug/claude/chat/${chatId}`);
}
