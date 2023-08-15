import {redirect} from "@remix-run/router";
import {getAlphaConfiguration} from "~/server/alpha/alpha_access_table.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";

/**
 * Redirect to the homepage for an account if they are successfully
 * authenticated.
 */
export async function redirectToAuthenticatedHome(context: DynamoContext) {
    const configuration = await getAlphaConfiguration(context);
    return redirect(
        configuration.authenticatedHomeUrl ??
            // TODO(calebmer): Maybe add a good fallback URL to route to?
            (configuration.defaultSpaceId ? `/s/${configuration.defaultSpaceId}` : "/404"),
    );
}
