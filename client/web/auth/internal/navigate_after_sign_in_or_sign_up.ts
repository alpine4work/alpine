import {NavigateFunction} from "~/client/web/remix/use_navigate.js";
import {AuthSignInOrSignUpOpen} from "~/shared/auth/auth_sign_in_or_sign_up_schema.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isId} from "~/shared/id/id.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export async function navigateAfterSignInOrSignUp({
    navigate,
    searchParams,
    open,
}: {
    navigate: NavigateFunction;
    searchParams: URLSearchParams;
    open: AuthSignInOrSignUpOpen | null;
}) {
    const toSearchParam = searchParams.get("to");
    const inviteSearchParam = searchParams.get("invite");

    if (toSearchParam?.startsWith("/")) {
        // Immediately navigate to the `to` search param.
        await navigate(toSearchParam);
    } else if (inviteSearchParam && isId<SpaceId>(inviteSearchParam)) {
        // Navigate to the invite accept page for the specified space.
        await navigate(`/s/${inviteSearchParam}/invite/accept`);
    } else if (open) {
        switch (open.type) {
            case "ActiveSpace": {
                // Open the space sign in (or sign up) tells us to open.
                await navigate(`/s/${open.spaceId}`);
                break;
            }
            case "InvitePendingSpace": {
                // Let the account choose whether to accept their most recent pending invite.
                await navigate(`/s/${open.spaceId}/invite`);
                break;
            }
            default:
                throw exhaustive(open);
        }
    } else {
        // The account has no space? Show them the space switcher.
        await navigate("/switch-space");
    }
}
