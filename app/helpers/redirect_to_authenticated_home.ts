import {redirect} from "@remix-run/router";
import {getOurLastOpenedSpaceId} from "~/server/accounts/accounts_table.js";
import {LoaderContext} from "~/server/remix/loader_context.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Redirect to the homepage for an account if they are successfully
 * authenticated.
 */
export async function redirectToAuthenticatedHome(loaderContext: LoaderContext) {
    const context = await loaderContext.actor.authenticate();

    switch (context.actor.type) {
        case "System": {
            // Allowing a system actor to load our app would be very dangerous! Since
            // system actors have read/write access to everything in the space.
            throw new PermissionDeniedError("Can’t load the application with a system actor");
        }

        case "ImpersonatedAccount": {
            // Allowing a system actor to load our app would be dangerous! Since a system
            // actor can pretend to be any arbitrary account in the space.
            throw new PermissionDeniedError(
                "Can’t load the application with an impersonated account actor",
            );
        }

        case "Anonymous": {
            // We don't have any context to what Anonymous users will expect to see here
            // Just throw them to the space switcher
            return redirect("/switch-space");
        }

        case "Session": {
            const defaultSpaceId = await getOurLastOpenedSpaceId(
                await context.actor.authenticate(),
            );
            return redirect(defaultSpaceId ? `/s/${defaultSpaceId}` : "/switch-space");
        }

        default:
            throw exhaustive(context.actor);
    }
}
