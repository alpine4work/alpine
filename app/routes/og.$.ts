import {createDocumentationOpenGraphImageResponse} from "~/app/docs/create_documentation_open_graph_image_response.server.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {notFoundResponse} from "~/server/remix/not_found_response.js";

/**
 * Serve build-time Open Graph images for docs, API reference, and blog pages.
 */
export async function loader({params}: LoaderArgs) {
    const path = params["*"];
    if (path === undefined || !path.endsWith(".png")) throw notFoundResponse();

    return await createDocumentationOpenGraphImageResponse(path.slice(0, -".png".length));
}
