import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {createAccountModelWithoutSpaceFromItem} from "~/server/accounts/internal/create_account_model_without_space_from_item.js";
import {getAccountItem} from "~/server/accounts/internal/get_account_item.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {
    AccountModelWithoutSpace,
    unknownAccountId,
} from "~/shared/accounts/account_model_without_space.js";
import {NotFoundError} from "~/shared/error/error.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Get any `AccountModelWithoutSpace` by `AccountId`. The actor must have internal
 * access to make this request.
 */
export async function getAccountByIdAsAdmin(
    context: ServerActionContext,
    accountId: AccountId,
): Promise<AccountModelWithoutSpace> {
    await authorizeInternalAccess(context);

    // Pretend like the unknown account doesn't exist. We do have an unknown account
    // record in our database as a safety precaution to make sure we don't accidentally
    // create an account with the unknown `AccountId`. But we should never return that
    // data. Instead if you want data for an unknown account call
    // `AccountModel.getUnknown()`.
    //
    // Calling `getAccount(unknownAccountId)` should always fail with a not found
    // error.
    if (accountId === unknownAccountId)
        throw new NotFoundError("Unknown account is treated as if it doesn\u2019t exist");
    const accountItem = await getAccountItem(context, accountId);

    return createAccountModelWithoutSpaceFromItem(accountItem);
}
