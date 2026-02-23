import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {dangerouslyGetAccountStubIfExistsWithoutAuthorization} from "~/server/spaces/dangerously_get_account_stub_if_exists_without_authorization.js";
import {createSpaceAccountNotFoundError, getAccount} from "~/server/spaces/get_account.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Calls `getAccount()` if the actor has space access and falls back to
 * `dangerouslyGetAccountStubIfExistsWithoutAuthorization()` if the actor
 * doesn't have space access.
 *
 * Please read the documentation on
 * `dangerouslyGetAccountStubIfExistsWithoutAuthorization()` before
 * deciding to use this function.
 */
export async function getAccountOrDangerouslyGetStubWithoutAuthorization(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<AccountModel> {
    if ((await authorizeSpaceAccessIfPossible(context, spaceId)).ok) {
        return getAccount(context, spaceId, accountId);
    }

    const accountStub = await dangerouslyGetAccountStubIfExistsWithoutAuthorization(
        context,
        spaceId,
        accountId,
    );
    if (!accountStub) throw createSpaceAccountNotFoundError();
    return accountStub;
}
