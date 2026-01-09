import {
    SpaceAccountItem,
    SpaceAccountItemWithAccountAvatarOverride,
} from "~/server/spaces/internal/spaces_table.js";
import {
    AccountModelWithoutSpace,
    AccountModelWithoutSpaceAndAvatarData,
    AccountModelWithoutSpaceData,
} from "~/shared/accounts/account_model_without_space.js";
import {createAvatarModelFromItem} from "~/shared/avatar/create_avatar_model_from_item.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

export function createAccountModelFromItem(
    item: SpaceAccountItemWithAccountAvatarOverride,
    account: AccountModelWithoutSpace | null,
): AccountModel {
    let accountData: AccountModelWithoutSpaceData | AccountModelWithoutSpaceAndAvatarData;

    switch (item.state.type) {
        case "Active": {
            assert(account !== null);
            accountData = account.initialData;
            break;
        }
        case "InvitePending": {
            // If the account is pending, we should use the pending account data that was
            // given when the account was invited.
            assert(account === null);
            accountData = item.state.pendingAccountData;
            break;
        }
        case "Removed": {
            // If the account was removed, we should use the old account data that was
            // present when the account was removed.
            assert(account === null);
            accountData = item.state.oldAccountData;
            break;
        }
        default:
            throw exhaustive(item.state);
    }

    return new AccountModel({
        ...accountData,
        avatar: getAccountAvatarModelForAccountModel(item, account),
        space: createSpaceAccountModelFromItem(item),
    });
}

export function createSpaceAccountModelFromItem(item: SpaceAccountItem): AccountModelData["space"] {
    return {
        version: item.updateLockVersion ?? 0,
        addedTime: item.addedTime,
        state: item.state,
        role: item.role,
    };
}

function getAccountAvatarModelForAccountModel(
    item: SpaceAccountItemWithAccountAvatarOverride,
    account: AccountModelWithoutSpace | null,
) {
    switch (item.state.type) {
        case "Active": {
            assert(account !== null);

            // TODO(ifitzsimmons, 2025-08-28, #account-override-avatar-coupling): If there is an
            // accountAvatarOverride item on the space account, we should emit a warning.
            return account.initialData.avatar;
        }
        case "InvitePending":
        case "Removed": {
            if (!item.accountAvatarOverride) {
                // TODO(ifitzsimmons, 2025-08-28, #account-override-avatar-coupling): This is an
                // impossible state. We should emit an error without crashing the app. To avoid
                // app crashes, we overwrite the account avatar with a null avatar if we get into
                // this state.
                return {avatarId: null, content: null, version: 0};
            }

            return createAvatarModelFromItem(item.accountAvatarOverride);
        }
        default:
            throw exhaustive(item.state);
    }
}

export function createAccountModelDataWithoutAvatarFromItem(
    item: SpaceAccountItem,
    activeAccountData: Omit<AccountModelWithoutSpaceData, "avatar"> | null,
): Omit<AccountModelData, "avatar"> {
    let accountData: AccountModelWithoutSpaceData | AccountModelWithoutSpaceAndAvatarData;

    switch (item.state.type) {
        case "Active": {
            assert(activeAccountData !== null);
            accountData = activeAccountData;
            break;
        }
        case "InvitePending": {
            // If the account is pending, we should use the pending account data that was
            // given when the account was invited.
            assert(activeAccountData === null);
            accountData = item.state.pendingAccountData;
            break;
        }
        case "Removed": {
            // If the account was removed, we should use the old account data that was
            // present when the account was removed.
            assert(activeAccountData === null);
            accountData = item.state.oldAccountData;
            break;
        }
        default:
            throw exhaustive(item.state);
    }

    return {
        ...accountData,
        space: {
            version: item.updateLockVersion ?? 0,
            addedTime: item.addedTime,
            state: item.state,
            role: item.role,
        },
    };
}
