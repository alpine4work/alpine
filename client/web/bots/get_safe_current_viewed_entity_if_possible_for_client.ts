import {SpaceContext} from "~/client/web/spaces/context/space_context_types.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

/**
 * When sending a chat message notification event, we want to make sure that we
 * only propagate the currently viewed entity if it's in a 1:1 chat with a bot.
 *
 * IMPORTANT: Keep this function in sync with
 * `getSafeCurrentlyViewedEntityIfPossibleForServer`
 */
// TODO(ifitzsimmons, share-entity-with-agents): This should support a multi-agent
// chat. For example, I should be able to start a chat with ChatGPT and Cursor and
// they should both have access to the entity that I'm looking at. However, this
// involves some careful thought. We don't want to do a bunch of async work here
// and slow down the agent's response. We probably want to check
// `isBotSpaceAccount` for every account id (other than the author) and return
// false as soon as we find a human.
export function getSafeCurrentlyViewedEntityIfPossibleForClient(
    context: SpaceContext,
    chat: ChatModel | undefined,
    currentlyViewedSearchEntityId: SearchMentionEntityId | null,
): SearchMentionEntityId | null {
    if (currentlyViewedSearchEntityId === null || chat === undefined) return null;

    // Currently viewed entity is only allowed in 1:1 chats with a bot.
    if (chat.definition.type !== "Direct") return null;

    const {accounts} = chat.definition;
    if (accounts.length !== 2) return null;

    const currentAccountInChat = accounts.find(
        account => account.id === context.currentAccount?.id,
    );
    assert(currentAccountInChat !== undefined);

    const otherAccount = accounts.find(account => account.id !== currentAccountInChat.id);
    assert(otherAccount !== undefined);

    return otherAccount.botId ? currentlyViewedSearchEntityId : null;
}
