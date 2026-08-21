import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getAccountItemWithoutAvatar} from "~/server/accounts/internal/get_account_item.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {BotOwnerEntityId} from "~/shared/bots/owners/bot_owner_entity.js";
import {Context} from "~/shared/context/context.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

/**
 * You should not call this function! It does not authorize that you are allowed to
 * update the bot account's owner. We only call this via the JobQueueService, from
 * the `Owner` case of `processUpdateBotAccountsJob()`, to copy a bot's owner onto
 * each of its accounts (see the `bot` property in `accounts_table.ts`).
 */
export async function dangerouslyUpdateBotAccountOwnerWithoutAuthorization(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    {accountId, ownerEntity}: {accountId: AccountId; ownerEntity: BotOwnerEntityId},
): Promise<void> {
    // Eventually consistent on the first attempt like the rename job: an owner written
    // over a stale item fails the `updateLockVersion` condition and retries strongly.
    let consistency: DynamoCacheReadConsistency = "Eventual";

    await context.dynamo.retryTransaction(async context => {
        const oldAccountItem = await getAccountItemWithoutAvatar(context, accountId, {consistency});
        consistency = "StrongWithinCache";

        const {bot} = oldAccountItem;
        assert(bot !== undefined, "Expected account to be a bot account");

        // If the account already has that owner there's nothing to do.
        if (bot.ownerEntity === ownerEntity) return;

        await AccountsTable.directlyUpdateItem(context, {
            ...oldAccountItem,
            bot: {...bot, ownerEntity},
        });
    });
}
