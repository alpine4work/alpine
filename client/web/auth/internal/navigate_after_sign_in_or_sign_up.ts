import {NavigateFunction} from "~/client/web/remix/use_navigate.js";
import {AuthSignInOrSignUpOpen} from "~/shared/auth/auth_sign_in_or_sign_up_schema.js";
import {neverPromise} from "~/shared/helpers/async/never_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isId} from "~/shared/id/id.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";

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
        // To navigate to a route that doesn't include a `$spaceId` variable we need to
        // perform a full page navigation because Remix can't make `?_data` requests to the
        // space layout route. The space layout route must be run alongside a different
        // route which discovers the `SpaceId`.
        window.location.assign(toSearchParam);
        await neverPromise;
    } else if (inviteSearchParam && isId<SpaceId>(inviteSearchParam)) {
        // Navigate to the invite accept page for the specified space.
        await navigate(`/invite/${inviteSearchParam}/accept`);
    } else if (open) {
        switch (open.type) {
            case "ActiveSpace": {
                // Open the space sign in (or sign up) tells us to open.
                await navigate(`/home/${open.spaceId}`);
                break;
            }
            case "InvitePendingSpace": {
                // Let the account choose whether to accept their most recent pending invite.
                await navigate(`/invite/${open.spaceId}`);
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
