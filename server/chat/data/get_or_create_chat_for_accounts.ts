import {actuallyGetOrCreateChatForAccounts} from "~/server/chat/data/internal/actually_get_or_create_chat_for_accounts.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Gets the chat shared by the authorized account and the other provided
 * accounts and no one else. If an account does not exist yet for these
 * accounts then we will create one.
 *
 * This function is idempotent. You may call it multiple times in short
 * succession and get the same result.
 */
export async function getOrCreateChatForAccounts(
    context: ServerAccountActionContext,
    {
        spaceId,
        otherAccountIds,
    }: {
        spaceId: SpaceId;
        otherAccountIds: ReadonlyArray<AccountId>;
    },
): Promise<ChatId> {
    const {chatId} = await actuallyGetOrCreateChatForAccounts(context, {
        spaceId,
        actorAccountId: context.actor.getPossiblyBotAccountId(),
        otherAccountIds,
        initialSharedChatsPromise: null,
    });

    return chatId;
}
