import {redirect} from "@remix-run/cloudflare";
import {getAlphaConfiguration} from "~/server/dynamo/alpha_access_table";

/**
 * Redirect to the homepage for an account if they are successfully
 * authenticated.
 */
export async function redirectToAuthenticatedHome() {
    const configuration = await getAlphaConfiguration();
    return redirect(configuration.authenticatedHomeUrl ?? "/documents/create");
}
