import {ServerActionContext} from "~/server/context/server_action_context.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

/**
 * When sending a chat message notification event, we want to make sure that we
 * only propagate the currently viewed entity if it's in a 1:1 chat with a bot.
 *
 * IMPORTANT: Keep this function in sync with
 * `getSafeCurrentlyViewedEntityIfPossibleForClient`
 */
// TODO(ifitzsimmons, #share-entity-with-agents): This should support a multi-agent
// chat. For example, I should be able to start a chat with ChatGPT and Cursor and
// they should both have access to the entity that I'm looking at. However, this
// involves some careful thought. We don't want to do a bunch of async work here
// and slow down the agent's response. We probably want to check
// `isBotSpaceAccount` for every account id (other than the author) and return
// false as soon as we find a human.
//
// Look for #share-entity-with-agents in `chat_actions.ts` for more.
export async function getSafeCurrentlyViewedEntityIfPossibleForServer(
    context: ServerActionContext,
    spaceId: SpaceId,
    {
        accountIdsInChat,
        dangerousCurrentlyViewingSearchEntityId,
        authorId,
    }: {
        accountIdsInChat: ReadonlyArray<AccountId> | null;
        dangerousCurrentlyViewingSearchEntityId?: SearchMentionEntityId;
        authorId: AccountId;
    },
): Promise<SearchMentionEntityId | undefined> {
    if (!dangerousCurrentlyViewingSearchEntityId) return undefined;

    // Currently viewed entity is only allowed in 1:1 chats with a bot.
    if (!accountIdsInChat || accountIdsInChat.length !== 2) return undefined;

    const otherAccountId = accountIdsInChat.find(id => id !== authorId);

    const isBot = await isBotSpaceAccount(context, spaceId, assertExists(otherAccountId));

    // If it's a 1:1 chat with a human, then don't propagate the crrently viewed entity
    // any further.s
    if (!isBot) return undefined;

    return dangerousCurrentlyViewingSearchEntityId;
}
