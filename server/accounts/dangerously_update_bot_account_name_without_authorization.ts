import {AccountsTable} from "~/server/accounts/internal/accounts_table.js";
import {getAccountItemWithoutAvatar} from "~/server/accounts/internal/get_account_item.js";
import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {Context} from "~/shared/context/context.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * You should not call this function! It does not authorize that you are allowed to
 * update the bot account's name. We only call this via the JobQueueService – when
 * a bot is renamed, we copy the new name into the `Account#Attributes` item for
 * each bot account and reindex the account so search reflects the new name.
 */
export async function dangerouslyUpdateBotAccountNameWithoutAuthorization(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    {spaceId, accountId, name}: {spaceId: SpaceId; accountId: AccountId; name: string},
): Promise<void> {
    // Renaming a bot runs this for every one of the bot's accounts, so start with an
    // eventually consistent read. A stale read can't overwrite a newer name: the
    // update below is conditional on the item's `updateLockVersion`, so it fails and
    // we retry with the strongly consistent read.
    let consistency: DynamoCacheReadConsistency = "Eventual";

    await context.dynamo.retryTransaction(async context => {
        const oldAccountItem = await getAccountItemWithoutAvatar(context, accountId, {
            consistency,
        });
        consistency = "StrongWithinCache";

        assert(oldAccountItem.bot !== undefined, "Expected account to be a bot account");

        // If the account already has that name there's nothing to do.
        if (oldAccountItem.name === name) return;

        await AccountsTable.directlyUpdateItem(context, {
            ...oldAccountItem,
            name,
            // Bump `nameVersion` so the search index (which versions the account's title by
            // `nameVersion`) accepts the update.
            nameVersion: oldAccountItem.nameVersion + 1,
        });

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId,
            update: {
                type: "Account",
                accountId,
                updatedTraits: {type: "Some", traits: ["WithoutSpace"]},
            },
        });
    });
}
