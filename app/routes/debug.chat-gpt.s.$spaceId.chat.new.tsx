import {redirect} from "@remix-run/server-runtime";
import {
    deserializeAccountIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {getOrCreateChatForAccounts} from "~/server/chat/data/chat_actions.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";

export async function loader({request, context: unauthenticatedContext, params}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const url = new URL(request.url);
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);

    const selectedAccountIds = (url.searchParams.get("accounts")?.split(" ") ?? []).map(accountId =>
        deserializeAccountIdForLoader(accountId),
    );

    if (selectedAccountIds.length === 0) {
        throw new InvalidArgumentError("No accounts selected");
    }

    const chatId = await getOrCreateChatForAccounts(
        (await context.actor.authenticate()).actor.authorizeSession(),
        {
            spaceId,
            otherAccountIds: selectedAccountIds,
        },
    );

    return redirect(`/debug/chat-gpt/s/${spaceId}/chat/${chatId}`);
}
