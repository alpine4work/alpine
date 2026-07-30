import {redirect} from "@remix-run/node";
import {
    deserializeAccountIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InternalError} from "~/shared/error/error.js";

/**
 * This route automatically redirects from `/account/:accountId/:spaceId` to
 * `/chat/with/:accountId/:spaceId`. Eventually we'll want a dedicated account
 * profile page but for now we go to the 1:1 chat.
 */
export async function loader({params}: LoaderArgs) {
    if (process.env.NODE_ENV !== "production") {
        throw new InternalError(
            "Development only warning: If you\u2019re linking to an account then instead of navigating to `/account/:accountId/:spaceId` you should navigate directly to `/chat/with/:accountId/:spaceId`. It\u2019s a slight optimization since we don\u2019t need to perform a `redirect()` network roundtrip on the client",
        );
    }

    const accountId = deserializeAccountIdForLoader(params.accountId ?? null);
    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? null);

    // IMPORTANT: If you're updating this then also go and update
    // `mention.$accountId.tsx` too.
    return redirect(`/chat/with/${accountId}/${spaceId}`);
}
