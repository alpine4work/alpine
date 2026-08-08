import {ServerActionContext} from "~/server/context/server_action_context.js";
import {permissionDeniedBotError} from "~/server/helpers/permission_denied_bot_error.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {addSpaceAccountWithoutAuthorization} from "~/server/spaces/internal/add_space_account_without_authorization.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
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

    let inviterAccountId: AccountId | null;
    switch (context.actor.type) {
        case "Bot": {
            throw permissionDeniedBotError();
        }
        case "Session":
        case "ImpersonatedAccount": {
            const actorAccountId = context.actor.getAccountId();
            inviterAccountId = actorAccountId !== accountId ? actorAccountId : null;
            break;
        }
        case "System":
        case "Anonymous": {
            inviterAccountId = null;
            break;
        }
        default:
            throw exhaustive(context.actor);
    }

    return await addSpaceAccountWithoutAuthorization(context, {
        spaceId,
        accountId,
        role,
        inviterAccountId,
        withoutInviteForTest,
    });
}
