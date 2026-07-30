import {redirect} from "@remix-run/node";
import {deserializeSpaceIdForLoader} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InternalError} from "~/shared/error/error.js";

/**
 * This is an index route that automatically redirects from /settings/:spaceId to
 * /settings/:spaceId/general when a user manually visits /settings/:spaceId
 */
export async function loader({params}: LoaderArgs) {
    if (process.env.NODE_ENV !== "production") {
        throw new InternalError(
            "Development only warning: If you\u2019re linking to settings then instead of navigating to `/settings/:spaceId` you should navigate directly to `/settings/:spaceId/general`. It\u2019s a slight optimization since we don\u2019t need to perform a `redirect()` network roundtrip on the client",
        );
    }
    const spaceId = deserializeSpaceIdForLoader(params.spaceId);
    return redirect(`/settings/${spaceId}/general`);
}
