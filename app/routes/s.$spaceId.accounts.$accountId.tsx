import {redirect} from "@remix-run/node";
import {
    deserializeAccountIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {InternalError} from "~/shared/error/error.js";

/**
 * This is route that automatically redirects from
 * `/s/:spaceId/accounts/:accountId` to `/s/:spaceId/chat/with/:accountId`.
 * Eventually we'll want a dedicated account profile pages but for now we go to
 * the 1:1 chat.
 */
export async function loader({params}: LoaderArgs) {
    if (process.env.NODE_ENV !== "production") {
        throw new InternalError(
            "Development only warning: If you\u2019re linking to an account then instead of navigating to `/s/:spaceId/accounts/:accountId` you should navigate directly to `/s/:spaceId/chat/with/:accountId`. It\u2019s a slight optimization since we don\u2019t need to perform a `redirect()` network roundtrip on the client",
        );
    }
    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? null);
    const accountId = deserializeAccountIdForLoader(params.accountId ?? null);
    return redirect(`/s/${spaceId}/chat/with/${accountId}`);
}
