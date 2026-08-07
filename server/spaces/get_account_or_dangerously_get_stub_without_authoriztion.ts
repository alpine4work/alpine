import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {dangerouslyGetAccountStubIfExistsWithoutAuthorization} from "~/server/spaces/dangerously_get_account_stub_if_exists_without_authorization.js";
import {createSpaceAccountNotFoundError, getAccountIfExists} from "~/server/spaces/get_account.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Calls `getAccount()` if the actor has space access and falls back to
 * `dangerouslyGetAccountStubIfExistsWithoutAuthorization()` if the actor doesn't
 * have space access.
 *
 * Please read the documentation on
 * `dangerouslyGetAccountStubIfExistsWithoutAuthorization()` before deciding to use
 * this function.
 */
export async function getAccountOrDangerouslyGetStubWithoutAuthorization(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<AccountModel> {
    const account = await getAccountIfExistsOrDangerouslyGetStubWithoutAuthorization(
        context,
        spaceId,
        accountId,
    );
    if (!account) throw createSpaceAccountNotFoundError();
    return account;
}

async function getAccountIfExistsOrDangerouslyGetStubWithoutAuthorization(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<AccountModel | null> {
    if ((await authorizeSpaceAccessIfPossible(context, spaceId)).ok) {
        return await getAccountIfExists(context, spaceId, accountId);
    }

    return await dangerouslyGetAccountStubIfExistsWithoutAuthorization(context, spaceId, accountId);
}
