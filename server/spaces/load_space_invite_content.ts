import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {expensivelyGetAllSpaceAccounts} from "~/server/spaces/expensively_get_all_space_accounts.js";
import {getOwnAccountIfExists} from "~/server/spaces/get_own_account_if_exists.js";
import {getSpace} from "~/server/spaces/get_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export async function loadSpaceInviteContent(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
) {
    const [allAccounts, space] = await runAllPromises([
        expensivelyGetAllSpaceAccounts(context, spaceId, {
            allowInvitePending: true,
            consistency: "Strong",
        }),
        getSpace(context, spaceId, {
            allowInvitePending: true,
            consistency: "StrongWithinCache",
        }),
    ]);

    // This should be free. The `expensivelyGetAllSpaceAccounts()` call above should
    // have cached our account with strong consistency.
    const currentAccount = await getOwnAccountIfExists(
        context,
        spaceId,
        context.actor.getAccountId(),
        // Use strong consistency in case we're coming from sign up or some other flow
        // which just updated our account state.
        {consistency: "StrongWithinCache"},
    );

    if (!currentAccount) {
        throw new PermissionDeniedError("Account isn\u2019t invited to the space");
    }

    return {allAccounts, currentAccount, space};
}
