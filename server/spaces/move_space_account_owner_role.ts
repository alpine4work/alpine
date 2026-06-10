import {dangerouslyGetAccountIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {createAccountModelFromItem} from "~/server/spaces/internal/create_account_model_from_item.js";
import {getSpaceAccountItemIfExists} from "~/server/spaces/internal/get_space_account_item.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {createAuthorizeSpaceAccessPermissionDeniedError} from "~/shared/spaces/space_error_messages.js";

export const moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint =
    new TestCheckpoint<`${SpaceId}:${AccountId}`>();

/**
 * Move the ownership of a space to a new account and make previous `Owner` as
 * `Admin`
 *
 * Each space should have only one `Owner` by default which is made during the
 * creation of space using `createAlphaSpaceAsAdmin`. After creation of space you
 * can only edit `Owner` role using this function.
 *
 * We make sure only `Owner` can transfer the ownership to other accounts in client
 * as well as server using `authorizeSpaceAccess(context, spaceId, "Owner")`
 *
 * Be careful while dealing with `Owner` of the space as you cannot enforce single
 * owner using Schema library so we need to do that in code manually.
 */
export async function moveSpaceAccountOwnerRole(
    context: ServerSessionActionContext,
    {
        spaceId,
        newOwnerAccountId,
    }: {
        spaceId: SpaceId;
        newOwnerAccountId: AccountId;
    },
): Promise<{
    newOwnerAccount: AccountModel;
    oldOwnerAccount: AccountModel;
}> {
    // Make sure a session actor is moving the owner role and a system actor isn't
    // doing it on a session actor's behalf.
    context.actor.authorizeSession();

    await authorizeSpaceAccess(context, spaceId, "Owner");

    return await moveSpaceAccountOwnerRoleWithoutAuthorization(context, {
        spaceId,
        oldOwnerAccountId: context.actor.getAccountId(),
        newOwnerAccountId,
    });
}

export async function moveSpaceAccountOwnerRoleForTest(
    context: ServerActionContext,
    {
        spaceId,
        oldOwnerAccountId,
        newOwnerAccountId,
    }: {
        spaceId: SpaceId;
        oldOwnerAccountId: AccountId;
        newOwnerAccountId: AccountId;
    },
) {
    assert(import.meta.jest);

    await authorizeSpaceAccess(context, spaceId, "Owner");

    return await moveSpaceAccountOwnerRoleWithoutAuthorization(context, {
        spaceId,
        oldOwnerAccountId,
        newOwnerAccountId,
    });
}

function moveSpaceAccountOwnerRoleWithoutAuthorization(
    context: ServerActionContext,
    {
        spaceId,
        oldOwnerAccountId,
        newOwnerAccountId,
    }: {
        spaceId: SpaceId;
        oldOwnerAccountId: AccountId;
        newOwnerAccountId: AccountId;
    },
): Promise<{
    newOwnerAccount: AccountModel;
    oldOwnerAccount: AccountModel;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [oldSpaceAccountItem, newSpaceAccountItem, oldOwnerAccount, newOwnerAccount] =
            await runAllPromises([
                getSpaceAccountItemIfExists(context, spaceId, oldOwnerAccountId),
                getSpaceAccountItemIfExists(context, spaceId, newOwnerAccountId),
                dangerouslyGetAccountIfExistsWithoutAuthorization(context, oldOwnerAccountId),
                dangerouslyGetAccountIfExistsWithoutAuthorization(context, newOwnerAccountId),
            ]);

        // These should exist since the corresponding space items exist.
        assert(oldOwnerAccount);
        assert(newOwnerAccount);
        assert(oldSpaceAccountItem);
        assert(newSpaceAccountItem);

        // Double check the old account is an owner. This is important if we need to retry
        // the transaction.
        if (oldSpaceAccountItem.role !== "Owner") {
            throw createAuthorizeSpaceAccessPermissionDeniedError(
                spaceId,
                oldOwnerAccountId,
                "Owner",
            );
        }

        if (newSpaceAccountItem.state.type !== "Active") {
            throw new FailedPreconditionError(
                "Can\u2019t move space owner role to an inactive account",
            );
        }

        if (newSpaceAccountItem.botId) {
            throw new FailedPreconditionError("Can\u2019t move space owner role to bot account");
        }

        // when `oldOwnerAccountId === newOwnerAccountId`, we don't need to update anything
        // although this is impossible to do from Alpine UI.
        if (oldOwnerAccountId === newOwnerAccountId) {
            const account = createAccountModelFromItem(
                {
                    ...oldSpaceAccountItem,
                    // Active accounts should not have an avatar override
                    accountAvatarOverride: null,
                },
                oldOwnerAccount,
            );
            return {
                newOwnerAccount: account,
                oldOwnerAccount: account,
            };
        }

        const oldSpaceAccountItemUpdateEntry = SpacesTable.transactionDirectlyUpdateItem({
            ...oldSpaceAccountItem,
            role: "Admin",
        });
        const newSpaceAccountItemUpdateEntry = SpacesTable.transactionDirectlyUpdateItem({
            ...newSpaceAccountItem,
            role: "Owner",
        });

        await moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint.waitForTest(
            `${spaceId}:${newOwnerAccountId}`,
        );

        await DynamoTableSchema.executeTransaction(context, [
            oldSpaceAccountItemUpdateEntry,
            newSpaceAccountItemUpdateEntry,
        ]);

        return {
            newOwnerAccount: createAccountModelFromItem(
                {...newSpaceAccountItemUpdateEntry.newItem, accountAvatarOverride: null},
                newOwnerAccount,
            ),
            oldOwnerAccount: createAccountModelFromItem(
                {...oldSpaceAccountItemUpdateEntry.newItem, accountAvatarOverride: null},
                oldOwnerAccount,
            ),
        };
    });
}
