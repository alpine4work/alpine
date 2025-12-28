import {createAccountNameVersionConditionCheckTransactionEntry} from "~/server/accounts/create_account_name_version_condition_check_transaction_entry.js";
import {dangerouslyGetAccountIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
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

        const transactionEntries: Array<DynamoTransactionEntry> = [
            SpacesTable.transactionDirectlyUpdateItem({
                ...accountSpacesItem,
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
                spaceIds: accountSpaceIds,
                invitePendingSpaceIds: accountInvitePendingSpaceIds,
            }),
        ];

        const updateSpaceAccountItemTransactionEntry = SpacesTable.transactionDirectlyUpdateItem({
            ...spaceAccountItem,
            state,
        });
        transactionEntries.push(updateSpaceAccountItemTransactionEntry);

        if (newAccountStateType === "Active") {
            transactionEntries.push(
                SpacesTable.transactionDeleteItemIfExists({
                    partitionType: "Space",
                    sortRangeType: "AccountAvatarOverride",
                    spaceId,
                    accountId,
                }),
            );

            // Make sure to update our account's name in the task system as well when an
            // invite is accepted. The task system denormalizes account names so we can
            // efficiently sort alphabetically by account name (e.g. sort alphabetically by
            // task assignee name).
            const taskTransactionEntries =
                context.tasksInjection.internalGetUpdateOurAccountNameTaskTransactionEntries({
                    spaceIds: new Set([spaceId]),
                    name: account.initialData.name,
                    nameVersion: account.initialData.nameVersion,
                });

            for (const taskTransactionEntry of taskTransactionEntries) {
                transactionEntries.push(taskTransactionEntry);
            }

            // Prevent race conditions where the user is accepting their space invite and
            // updating their name at the same time. We should retry and get the latest
            // `nameVersion` if we don't have the right `nameVersion`. Otherwise we'll be
            // updating the task system with stale data.
            transactionEntries.push(
                createAccountNameVersionConditionCheckTransactionEntry(
                    accountId,
                    account.initialData.nameVersion,
                ),
            );
        }

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        let accountAvatarOverride = null;
        if (newAccountStateType !== "Active") {
            accountAvatarOverride = await SpacesTable.getItemIfExists(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "AccountAvatarOverride",
                    spaceId,
                    accountId,
                },
                // Make sure there's no eventual consistency lag for newly inactive accounts.
                {consistency: "Strong"},
            );
        }

        if (newAccountStateType === "Active") {
            // Reindex the account in the space. Since when made active the account name
            // changes from the temporary email address account name to the real account
            // name. This will recursively update any search entities where the account is
            // mentioned.
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
