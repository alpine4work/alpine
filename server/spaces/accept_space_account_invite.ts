import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {updateSpaceAccountWithInviteDecision} from "~/server/spaces/internal/update_space_account_with_invite_decision.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Accept a space account invite by marking the account as "Active".
 */
export async function acceptSpaceAccountInvite(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<AccountModel> {
    return await updateSpaceAccountWithInviteDecision(context, {
        spaceId,
        newAccountStateType: "Active",
    });
}
