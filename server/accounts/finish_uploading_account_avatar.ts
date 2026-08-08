import {AccountAvatarItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {createAccountModelWithoutSpaceFromItem} from "~/server/accounts/internal/create_account_model_without_space_from_item.js";
import {getAccountItem} from "~/server/accounts/internal/get_account_item.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {AccountModelWithoutSpace} from "~/shared/accounts/account_model_without_space.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {AccountId, AvatarId} from "~/shared/id/types/id_types.open_source.js";

export async function finishUploadingAccountAvatar(
    context: ServerSessionActionContext,
    {
        avatarContent,
        accountId,
        avatarId,
    }: {
        avatarContent: Uint8Array;
        accountId: AccountId;
        avatarId: AvatarId;
    },
): Promise<AccountModelWithoutSpace> {
    if (context.actor.getAccountId() !== accountId) {
        throw new PermissionDeniedError(
            "Can\u2019t access account that\u2019s not the actor\u2019s",
        );
    }

    return await context.dynamo.retryTransaction(async context => {
        const oldAccountItem = await getAccountItem(context, accountId);
        const oldAccountAvatar = oldAccountItem.avatar;

        const newAvatarItem: AccountAvatarItem = {
            ...oldAccountAvatar,
            partitionType: "Account",
            sortRangeType: "Avatar",
            accountId,
            avatarId,
            content: avatarContent,
        };

        // NOTE(ifitzsimmons, 2025-08-15): We considered adding a check to ensure that the
        // new avatarId is newer than the old avatarId. We opted against that for now, see
        // reasoning here:
        // https://app.graphite.dev/github/pr/cyberworlds/cyberworlds/312/add-rpc-implementation-for-uploading-account-avatars#comment-PRRC_kwDOH2ktg86H2sCi
        const accountAvatarItem = await AccountsTable.directlyUpdateItem(context, newAvatarItem);

        return createAccountModelWithoutSpaceFromItem({
            ...oldAccountItem,
            avatar: accountAvatarItem,
        });
    });
}
