import {AccountItem} from "~/server/accounts/internal/accounts_table.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {createAvatarModelFromItem} from "~/shared/avatar/create_avatar_model_from_item.js";

export function createAccountModelWithoutSpaceFromItem(accountItem: AccountItem) {
    return new AccountModelWithoutSpace({
        id: accountItem.accountId,
        version: accountItem.updateLockVersion ?? 0,
        name: accountItem.name,
        nameVersion: accountItem.nameVersion ?? 0,
        botId: accountItem.bot?.botId,
        reactionCharacter: accountItem.reactionCharacter,
        avatar: createAvatarModelFromItem(accountItem.avatar),
    });
}
