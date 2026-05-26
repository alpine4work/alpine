import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {addSpaceAccountWithoutAuthorization} from "~/server/spaces/internal/add_space_account_without_authorization.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceRole} from "~/shared/spaces/space_model.js";

/**
 * Add an account to some space. Only space admins may call this method.
 */
export async function addSpaceAccount(
    context: ServerActionContext,
    {
        spaceId,
        accountId,
        role,
        withoutInviteForTest = false,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        role?: SpaceRole;
        withoutInviteForTest?: boolean;
    },
): Promise<AccountModel> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    return await addSpaceAccountWithoutAuthorization(context, {
        spaceId,
        accountId,
        role,
        withoutInviteForTest,
    });
}
