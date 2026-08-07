import {redirect} from "@remix-run/router";
import {getOurLastOpenedSpaceId} from "~/server/accounts/with_spaces/get_our_last_opened_space_id.js";
import {LoaderContext} from "~/server/remix/loader_context.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

// Search params that we allow to be forwarded when redirecting to the
// authenticated home
const searchParamsAllowlist = new Set<string>(["purchased"]);

/**
 * Redirect to the homepage for an account if they are successfully authenticated.
 */
export async function redirectToAuthenticatedHome(loaderContext: LoaderContext) {
    const context = await loaderContext.actor.authenticate();

    const searchParams = new URLSearchParams();
    for (const [key, value] of loaderContext.loader.getSearchParams().entries()) {
        if (searchParamsAllowlist.has(key)) {
            searchParams.append(key, value);
        }
    }

    const searchParamsString = searchParams.toString() ? `?${searchParams.toString()}` : "";

    switch (context.actor.type) {
        case "System": {
            // Allowing a system actor to load our app would be very dangerous! Since system
            // actors have read/write access to everything in the space.
            throw new PermissionDeniedError("Can\u2019t load the application with a system actor");
        }

        case "ImpersonatedAccount": {
            // Allowing a system actor to load our app would be dangerous! Since a system actor
            // can pretend to be any arbitrary account in the space.
            throw new PermissionDeniedError(
                "Can\u2019t load the application with an impersonated account actor",
            );
        }

        case "Bot": {
            // Bots aren't allowed to load the app. They must use `ApiService` to interact with
            // Alpine.
            throw new PermissionDeniedError("Can\u2019t load the application with a bot actor");
        }

        case "Anonymous": {
            // We don't have any context to what Anonymous users will expect to see here Just
            // throw them to the space switcher
            return redirect(`/switch-space${searchParamsString}`);
        }

        case "Session": {
            const defaultSpaceId = await getOurLastOpenedSpaceId(
                await context.actor.authenticate(),
            );

            return redirect(
                defaultSpaceId
                    ? `/home/${defaultSpaceId}${searchParamsString}`
                    : `/switch-space${searchParamsString}`,
            );
        }

        default:
            throw exhaustive(context.actor);
    }
}
