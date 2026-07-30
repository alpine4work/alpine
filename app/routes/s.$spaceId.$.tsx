import {redirect} from "@remix-run/router";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {convertLegacySpacePath} from "~/shared/search/convert_legacy_space_path.js";

// Redirect from the old `/s/$spaceId/...` URL format to the new URL format.
export async function loader({request}: LoaderArgs) {
    const url = new URL(request.url);
    const conversion = convertLegacySpacePath({
        pathname: url.pathname,
        search: url.search,
    });

    if (!conversion) {
        throw new Response("404 Not Found", {status: 404});
    }

    return redirect(`${conversion.pathname}${conversion.search}${url.hash}`, 301);
}
