import {createAccountVersionConditionCheckTransactionEntry} from "~/server/accounts/create_account_version_condition_check_transaction_entry.js";
import {dangerouslyGetAccountIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {createSpaceAccountNotFoundError} from "~/server/spaces/get_account.js";
import {createAccountModelFromItem} from "~/server/spaces/internal/create_account_model_from_item.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {getSpaceItem} from "~/server/spaces/internal/get_space_item.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {hasSpaceRole} from "~/shared/spaces/space_model.js";

/**
 * Remove an account from some space. Only space admins may call this method.
 */
export async function removeSpaceAccount(
    context: ServerActionContext,
    {spaceId, accountId}: {spaceId: SpaceId; accountId: AccountId},
): Promise<AccountModel> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            if (context.actor.getAccountId() === accountId) {
                throw new InvalidArgumentError("Can\u2019t remove your own account from space");
            }
            break;
        }
        case "System":
        case "Anonymous":
        case "Bot":
            break;
        default:
            throw exhaustive(context.actor);
    }

    return await removeSpaceAccountWithoutAuthorization(context, {spaceId, accountId});
}

export const removeSpaceAccountBeforeExecuteTestCheckpoint =
    new TestCheckpoint<`${SpaceId}:${AccountId}`>();

/**
 * Removes an account to a space without authorizing the actor has permission to
 * remove accounts from the space.
 */
function removeSpaceAccountWithoutAuthorization(
    context: ServerActionContext,
    {spaceId, accountId}: {spaceId: SpaceId; accountId: AccountId},
): Promise<AccountModel> {
    return context.dynamo.retryTransaction(async context => {
        const currentTime = new Date();

        const [spaceItem, account, spaceAccountItem, accountSpacesItem] = await runAllPromises([
            getSpaceItem(context, spaceId),
            dangerouslyGetAccountIfExistsWithoutAuthorization(context, accountId),
            getSpaceAccountItemIfExists(context, spaceId, accountId),
            SpacesTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
            }),
        ]);

        if (!account) throw createSpaceAccountNotFoundError();

        // We don't check accountSpaceIds here because we don't add to spaceIds until the
        // user accepts the invite.
        if (!spaceAccountItem || spaceAccountItem.state.type === "Removed") {
            throw new FailedPreconditionError("Account is not a member of the space");
        }

        if (hasSpaceRole(spaceAccountItem.role, "Owner")) {
            throw new FailedPreconditionError("Can\u2019t remove owner from space");
        }

        const accountSpaceIds: Set<SpaceId> = accountSpacesItem
            ? new Set(accountSpacesItem.spaceIds)
            : new Set();

        const accountInvitePendingSpaceIds: Set<SpaceId> = accountSpacesItem
            ? new Set(accountSpacesItem.invitePendingSpaceIds)
            : new Set();

        accountSpaceIds.delete(spaceId);
        accountInvitePendingSpaceIds.delete(spaceId);

        const updateSpaceAccountItemTransactionEntry = SpacesTable.transactionDirectlyUpdateItem({
            ...spaceAccountItem,
            role: "Member",
            state: {
                type: "Removed",
                removedTime: currentTime,
                oldAccountData: account?.initialData,
                reason: "ActionByAdmin",
            },
        });

        const updateAccountAvatarOverrideTransactionEntry =
            SpacesTable.transactionCreateOrReplaceItem({
                partitionType: "Space",
                sortRangeType: "AccountAvatarOverride",
                spaceId,
                accountId,
                avatarId: account.initialData.avatar?.avatarId ?? null,
                content: account.initialData.avatar?.content ?? null,
                // NOTE(ifitzsimmons, 2025-08-25): When copying over the avatar content to the
                // account avatar override item, we want to increment the version so that the
                // SpaceAccountItem has the most recent avatar version. On the client, this will
                // ensure that the AccountModel merge will use the override version.
                updateLockVersion: (account.initialData.avatar?.version ?? 0) + 1,
            });

        await removeSpaceAccountBeforeExecuteTestCheckpoint.waitForTest(`${spaceId}:${accountId}`);

        await DynamoTableSchema.executeTransaction(context, [
            // Since this transaction is security sensitive, make sure the account and space
            // didn't update when we commit. This also makes sure both the space and account
            // exist.
            SpacesTable.transactionUpdateLockVersionConditionCheck(
                spaceItem,
                spaceItem.updateLockVersion,
            ),
            createAccountVersionConditionCheckTransactionEntry(
                accountId,
                account.initialData.version,
            ),

            SpacesTable.transactionDirectlyUpdateItem({
                ...accountSpacesItem,
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
                // update to new accountSpaceIds after removing the space from the account
                spaceIds: accountSpaceIds,
                invitePendingSpaceIds: accountInvitePendingSpaceIds,
            }),
            updateSpaceAccountItemTransactionEntry,
            updateAccountAvatarOverrideTransactionEntry,
        ]);

        // When an account is removed from a space, index the account in the space so it
        // can be searched.
        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId,
            update: {
                type: "Account",
                accountId,
                updatedTraits: {type: "Some", traits: []},
            },
        });

        return createAccountModelFromItem(
            {
                ...updateSpaceAccountItemTransactionEntry.newItem,
                accountAvatarOverride: updateAccountAvatarOverrideTransactionEntry.newItem,
            },
            null,
        );
    });
}
