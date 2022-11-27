import {redirect} from "@remix-run/cloudflare";
import {ProcessContext} from "~/server/context/context";
import {getAlphaConfiguration} from "~/server/dynamo/alpha_access_table";

/**
 * Redirect to the homepage for an account if they are successfully
 * authenticated.
 */
export async function redirectToAuthenticatedHome(context: ProcessContext) {
    const configuration = await getAlphaConfiguration(context);
    // TODO(calebmer): Maybe add a good fallback URL to route to?
    return redirect(configuration.authenticatedHomeUrl ?? "/404");
}
