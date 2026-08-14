import {AccountAvatarItem, AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {createAccountModelWithoutSpaceFromItem} from "~/server/accounts/internal/create_account_model_without_space_from_item.js";
import {getAccountItem} from "~/server/accounts/internal/get_account_item.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {Context} from "~/shared/context/context.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {AvatarId} from "~/shared/id/types/id_types.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

/**
 * You should not call this function! It does not authorize that you are allowed to
 * update the bot account's avatar. We only call this via the JobQueueService
 * – when an admin updates a bot's avatar, we copy the avatar into the
 * `Account#Avatar` item for each bot account.
 */
export async function dangerouslyUpdateBotAccountAvatarWithoutAuthorization(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    botAccountId: AccountId,
    {avatarId, avatarContent}: {avatarId: AvatarId; avatarContent: Uint8Array},
) {
    return await context.dynamo.retryTransaction(async context => {
        const oldAccountItem = await getAccountItem(context, botAccountId);

        assert(oldAccountItem.bot !== undefined);

        const oldAccountAvatar = oldAccountItem.avatar;

        // NOTE(ifitzsimmons, #2025-12-15): When we update a Bot's avatar, we create an
        // async job to update the `Account#Avatar` item for each Account associated with
        // the bot. This operation needs to be idempotent. When the job runs, it fetches
        // the most recent Avatar from the `Bot#Avatar` item and copies it into the
        // `Account#Avatar` item for every bot `Account`. If a user were to change the
        // bot's avatar twice in quick succession, we would end up with two async jobs
        // running in parallel. Without this check, it's possible that the job associated
        // with the second update runs first for some or all accounts. This would result in
        // the second update being lost.
        //
        // Avatar Ids are `ChronologicalId`s. When copying a bot's avatar into the
        // `Account#Avatar` item, we can guarantee idempotency by checking if the new
        // avatarId is greater than the old avatarId.
        if (oldAccountAvatar?.avatarId && oldAccountAvatar.avatarId >= avatarId) {
            return createAccountModelWithoutSpaceFromItem(oldAccountItem);
        }

        const newAvatarItem: AccountAvatarItem = {
            ...oldAccountAvatar,
            partitionType: "Account",
            sortRangeType: "Avatar",
            accountId: botAccountId,
            avatarId,
            content: avatarContent,
        };

        const accountAvatarItem = await AccountsTable.directlyUpdateItem(context, newAvatarItem);

        return createAccountModelWithoutSpaceFromItem({
            ...oldAccountItem,
            avatar: accountAvatarItem,
        });
    });
}
