import {redirect} from "@remix-run/cloudflare";

/**
 * Redirect to the homepage for an account if they are successfully
 * authenticated.
 */
export function redirectToAuthenticatedHome() {
    // TODO(calebmer): Actual home page to redirect people to.
    return redirect("/documents/create");
}
