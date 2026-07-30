import {redirectToAuthenticatedHome} from "~/app/helpers/redirect_to_authenticated_home.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {PermissionDeniedError} from "~/shared/error/error.js";

export async function loader({context}: LoaderArgs) {
    // Can not access this page while signed in.
    if (await context.actor.isAuthenticatedSession()) {
        return await redirectToAuthenticatedHome(context);
    }

    throw new PermissionDeniedError(
        "`EdgeService` should redirect unauthenticated requests to `/` to the landing page",
    );
}
