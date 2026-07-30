import {redirect} from "@remix-run/node";
import {
    documentationRouteHeaders,
    getDocumentationResponseHeaders,
} from "~/app/docs/documentation_response_headers.server.js";
import {loadFirstGeneratedDocumentationUrl} from "~/app/docs/load_generated_docs.server.js";
import {documentationHomeUrl} from "~/client/web/docs/documentation_home_url.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";

export function meta() {
    return [
        {title: `Alpine Documentation${metaTitlePostfix}`},
        // TODO(#public-api): Remove this robots restriction when the public API is ready.
        {name: "robots", content: "noindex,nofollow"},
    ];
}

/** Redirect the docs index to the first generated guide. */
export async function loader() {
    return redirect((await loadFirstGeneratedDocumentationUrl()) ?? documentationHomeUrl, {
        headers: getDocumentationResponseHeaders(),
    });
}

export const headers = documentationRouteHeaders;
