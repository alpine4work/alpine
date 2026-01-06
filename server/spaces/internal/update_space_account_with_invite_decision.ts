import {dangerouslyGetAccountIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeOwnSpaceAccountAccess} from "~/server/spaces/authorize_own_space_account_access.js";
import {createAccountModelFromItem} from "~/server/spaces/internal/create_account_model_from_item.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {FailedPreconditionError, NotFoundError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel, AccountModelDataSpaceState} from "~/shared/spaces/account_model.js";

/**
 * Update the account space state with the decision made by the account
 * regarding the invitation to the space. If the account rejects the invitation,
 * the account is marked as "Removed" with a reason of "InviteRejectedAsSpam".
 * If the account accepts the invitation, the account is marked as "Active".
 */
export async function updateSpaceAccountWithInviteDecision(
    context: ServerSessionActionContext,
    {spaceId, newAccountStateType}: {spaceId: SpaceId; newAccountStateType: "Active" | "Removed"},
): Promise<AccountModel> {
    context.actor.authorizeSession();
    const accountId = context.actor.getAccountId();
    await authorizeOwnSpaceAccountAccess(context, accountId);

    return context.dynamo.retryTransaction(async context => {
        const [spaceAccountItem, account, accountSpacesItem] = await runAllPromises([
            getSpaceAccountItemIfExists(context, spaceId, accountId, {
                consistency: "Strong",
            }),
            dangerouslyGetAccountIfExistsWithoutAuthorization(context, accountId, {
                consistency: "Strong",
            }),
            SpacesTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
            }),
        ]);

        if (!spaceAccountItem) {
            throw new NotFoundError("Account not found in space");
        }

        if (!account) {
            throw new NotFoundError("Account not found");
        }

        if (spaceAccountItem.state?.type !== "InvitePending") {
            throw new FailedPreconditionError("Account invitation is not in pending state");
        }

        const accountSpaceIds: Set<SpaceId> = accountSpacesItem
            ? new Set(accountSpacesItem.spaceIds)
            : new Set();

        const accountInvitePendingSpaceIds: Set<SpaceId> = accountSpacesItem
            ? new Set(accountSpacesItem.invitePendingSpaceIds)
            : new Set();

        accountInvitePendingSpaceIds.delete(spaceId);

        let state: AccountModelDataSpaceState = {type: "Active"};
        if (newAccountStateType === "Active") {
            accountSpaceIds.add(spaceId);
        } else {
            state = {
                type: "Removed",
                removedTime: new Date(),
                oldAccountData: account.initialData,
                reason: "InviteRejectedAsSpam",
            };
        }

        const updateSpaceAccountItemTransactionEntry = SpacesTable.transactionDirectlyUpdateItem({
            ...spaceAccountItem,
            state,
        });
        const deleteAccountAvatarOverrideTransactionEntry =
            newAccountStateType === "Active"
                ? SpacesTable.transactionDeleteItemIfExists({
                      partitionType: "Space",
                      sortRangeType: "AccountAvatarOverride",
                      spaceId,
                      accountId,
                  })
                : undefined;

        await DynamoTableSchema.executeTransaction(context, [
            SpacesTable.transactionDirectlyUpdateItem({
                ...accountSpacesItem,
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
                spaceIds: accountSpaceIds,
                invitePendingSpaceIds: accountInvitePendingSpaceIds,
            }),
            updateSpaceAccountItemTransactionEntry,
            ...(deleteAccountAvatarOverrideTransactionEntry
                ? [deleteAccountAvatarOverrideTransactionEntry]
                : []),
        ]);

        let accountAvatarOverride = null;
        if (newAccountStateType !== "Active") {
            // NOTE(ifitzsimmons, #account-override-avatar-consistency):
            // “We know there’s a potential eventual consistency race condition here where
            // Space#Account has a non-Active state but we don’t find a
            // Space#AccountAvatarOverride item due to eventual consistency lag. We’re not
            // fixing this since we expect it to be quite rare in practice and the impact to be
            // a pretty minor glitch (removed account appears as if they didn’t have an avatar
            // set).
            accountAvatarOverride = await SpacesTable.getItemIfExists(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "AccountAvatarOverride",
                    spaceId,
                    accountId,
                },
                {consistency: "Strong"},
            );
        }

        if (newAccountStateType === "Active") {
            // Reindex the account in all space search indexes where it appears. This may
            // recursively update any search entities where the account is mentioned.
            context.jobs.send({
                type: "IndexSearchEntity",
                spaceId,
                update: {
                    type: "Account",
                    accountId,
                    updatedTraits: {type: "Some", traits: ["WithoutSpace"]},
                },
            });
        }

        return createAccountModelFromItem(
            {
                ...updateSpaceAccountItemTransactionEntry.newItem,
                accountAvatarOverride,
            },
            updateSpaceAccountItemTransactionEntry.newItem.state.type === "Active" ? account : null,
        );
    });
}
