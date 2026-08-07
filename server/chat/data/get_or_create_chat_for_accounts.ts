import {actuallyGetOrCreateChatForAccounts} from "~/server/chat/data/internal/actually_get_or_create_chat_for_accounts.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {AccountId, ChatId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Gets the chat shared by the authorized account and the other provided accounts
 * and no one else. If an account does not exist yet for these accounts then we
 * will create one.
 *
 * This function is idempotent. You may call it multiple times in short succession
 * and get the same result.
 */
export async function getOrCreateChatForAccounts(
    context: ServerAccountActionContext,
    {
        spaceId,
        otherAccountIds,
        consistency,
    }: {
        spaceId: SpaceId;
        otherAccountIds: ReadonlyArray<AccountId>;
        consistency?: DynamoCacheReadConsistency;
    },
): Promise<ChatId> {
    const {chatId} = await actuallyGetOrCreateChatForAccounts(context, {
        spaceId,
        actorAccountId: context.actor.getPossiblyBotAccountId(),
        otherAccountIds,
        initialSharedChatsPromise: null,
        consistency,
    });

    return chatId;
}
