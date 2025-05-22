import {redirect} from "@remix-run/node";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InternalError} from "~/shared/error/error.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * This is an index route that automatically redirects from /s/:spaceId/settings
 * to /s/:spaceId/settings/general when a user manually visits /s/:spaceId/settings
 */
export async function loader({params}: LoaderArgs) {
    if (process.env.NODE_ENV !== "production") {
        throw new InternalError(
            "Development only warning: If you're linking to settings then instead of navigating to `/s/:spaceId/settings` your should navigate directly to `/s/:spaceId/settings/general`. It's a slight optimization since we don't need to perform a `redirect()` network roundtrip on the client",
        );
    }
    const spaceId = Schema.id<SpaceId>().deserialize(params.spaceId ?? null);
    return redirect(`/s/${spaceId}/settings/general`);
}
