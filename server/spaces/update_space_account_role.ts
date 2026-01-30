import {dangerouslyGetAccountIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {createAccountModelFromItem} from "~/server/spaces/internal/create_account_model_from_item.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {
    FailedPreconditionError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceRole, hasSpaceRole} from "~/shared/spaces/space_model.js";

/**
 * Update the role of an account in a space.
 *
 * Only space owners and admins can update roles.
 *
 * Cannot modify the owner's role.
 */
export async function updateSpaceAccountRole(
    context: ServerActionContext,
    {spaceId, accountId, role}: {spaceId: SpaceId; accountId: AccountId; role: SpaceRole},
): Promise<AccountModel> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    if (role === "Owner") {
        throw new FailedPreconditionError(
            "Can\u2019t update a space account\u2019s role to owner (maybe you want `moveSpaceAccountOwnerRole()` instead)",
        );
    }

    return context.dynamo.retryTransaction(async context => {
        const [spaceItem, spaceAccountItem, account] = await runAllPromises([
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "Attributes",
                spaceId,
            }),
            getSpaceAccountItemIfExists(context, spaceId, accountId),
            dangerouslyGetAccountIfExistsWithoutAuthorization(context, accountId, {
                consistency: "Strong",
            }),
        ]);

        if (!spaceAccountItem || spaceAccountItem.state.type !== "Active") {
            throw new NotFoundError("Account is not an active member of the space");
        }

        // Should exist since we've checked that `spaceAccountItem` exists.
        assert(account);

        if (hasSpaceRole(spaceAccountItem.role, "Owner")) {
            throw new PermissionDeniedError("Can\u2019t modify space owner account\u2019s role");
        }

        if (account.botId) {
            throw new FailedPreconditionError("Can\u2019t modify bot account\u2019s role");
        }

        const updateSpaceAccountItemTransactionEntry = SpacesTable.transactionDirectlyUpdateItem({
            ...spaceAccountItem,
            role,
        });

        await DynamoTableSchema.executeTransaction(context, [
            // Since this transaction is security sensitive, make sure the account and
            // space didn't update when we commit. This also makes sure both the space and
            // account exist.
            SpacesTable.transactionUpdateLockVersionConditionCheck(
                spaceItem,
                spaceItem.updateLockVersion,
            ),
            updateSpaceAccountItemTransactionEntry,
        ]);

        return createAccountModelFromItem(
            {
                ...updateSpaceAccountItemTransactionEntry.newItem,
                // Active accounts should not have an avatar override
                accountAvatarOverride: null,
            },
            spaceAccountItem.state.type === "Active" ? account : null,
        );
    });
}
