import {ChatModel} from "~/shared/chat/chat_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {SearchAffinityEntityId} from "~/shared/search/search_entity_id.js";

export function getChatOrAccountSearchAffinityEntityId(
    currentAccountId: AccountId | undefined,
    chat: ChatModel,
): SearchAffinityEntityId {
    if (chat.definition.type === "Direct" && chat.definition.accounts.length <= 2) {
        if (currentAccountId && chat.definition.accounts.length === 2) {
            return `Account:${
                chat.definition.accounts.filter(account => account.id !== currentAccountId)[0]!.id
            }`;
        } else {
            // This branch covers chats with just 1 account (the current account's personal
            // chat) and 2 accounts when we don't have a `currentAccountId`.
            //
            // In 2-accounts-but-no-`currentAccountId` (which should happen in practice) we
            // arbitrarily pick one of the accounts. We can't use `Chat:${ChatId}` since the
            // chat isn't indexed.

            const accountIds = chat.definition.accounts
                .map(({id}) => id)
                .sort(defaultCompareStrings);

            return `Account:${assertExists(accountIds[0], "Chat can\u2019t have zero accounts")}`;
        }
    }

    return `Chat:${chat.id}`;
}
