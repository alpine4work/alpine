import {redirect} from "@remix-run/cloudflare";
import {getAlphaConfiguration} from "~/server/dynamo/alpha_access_table";
import {DynamoContext} from "~/server/dynamo/dynamo_context";

/**
 * Redirect to the homepage for an account if they are successfully
 * authenticated.
 */
export async function redirectToAuthenticatedHome(context: DynamoContext) {
    const configuration = await getAlphaConfiguration(context);
    // TODO(calebmer): Maybe add a good fallback URL to route to?
    return redirect(configuration.authenticatedHomeUrl ?? "/404");
}
