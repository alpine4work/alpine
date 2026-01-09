import {NavigateFunction} from "~/client/web/remix/use_navigate.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export async function navigateAfterSignInOrSignUp({
    navigate,
    searchParams,
    openSpaceId,
}: {
    navigate: NavigateFunction;
    searchParams: URLSearchParams;
    openSpaceId: SpaceId | null;
}) {
    const toSearchParam = searchParams.get("to");

    if (toSearchParam?.startsWith("/")) {
        // Immediately navigate to the `to` search param.
        await navigate(toSearchParam);
    } else if (openSpaceId) {
        // Open the space sign in (or sign up) tells us to open.
        await navigate(`/s/${openSpaceId}`);
    } else {
        // The account has no space? Show them the space switcher.
        await navigate("/switch-space");
    }
}
