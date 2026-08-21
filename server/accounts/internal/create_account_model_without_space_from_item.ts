import {AccountItem} from "~/server/accounts/internal/accounts_table.js";
import {
    AccountModelWithoutSpace,
    AccountModelWithoutSpaceData,
} from "~/shared/accounts/account_model_without_space.js";
import {createAvatarModelFromItem} from "~/shared/avatar/create_avatar_model_from_item.js";
import {parseBotOwnerEntityId} from "~/shared/bots/owners/bot_owner_entity.js";

export function createAccountModelWithoutSpaceFromItem(accountItem: AccountItem) {
    return new AccountModelWithoutSpace({
        ...createAccountModelDataWithoutSpaceAndWithoutAvatarFromItem(accountItem),
        avatar: createAvatarModelFromItem(accountItem.avatar),
    });
}

export function createAccountModelDataWithoutSpaceAndWithoutAvatarFromItem(
    accountItem: Omit<AccountItem, "avatar">,
): Omit<AccountModelWithoutSpaceData, "avatar"> {
    return {
        id: accountItem.accountId,
        version: accountItem.updateLockVersion ?? 0,
        name: accountItem.name,
        nameVersion: accountItem.nameVersion ?? 0,
        bot: accountItem.bot && {
            id: accountItem.bot.botId,
            owner: parseBotOwnerEntityId(accountItem.bot.ownerEntity),
        },
        plan: accountItem.plan,
        reactionCharacter: accountItem.reactionCharacter,
    };
}
