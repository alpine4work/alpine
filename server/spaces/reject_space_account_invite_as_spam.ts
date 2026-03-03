import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {updateSpaceAccountWithInviteDecision} from "~/server/spaces/internal/update_space_account_with_invite_decision.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Reject a space account invite by marking the account as "Removed" with a reason
 * of "InviteRejectedAsSpam".
 *
 * This function is used when the account decides to reject the invitation to the
 * space, marking it as spam or unwanted.
 */
export async function rejectSpaceAccountInviteAsSpam(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<AccountModel> {
    return updateSpaceAccountWithInviteDecision(context, {
        spaceId,
        newAccountStateType: "Removed",
    });
}
