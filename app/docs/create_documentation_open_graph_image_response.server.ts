import {loadGeneratedDocumentationOpenGraphImage} from "~/app/docs/load_generated_docs.server.js";
import {notFoundResponse} from "~/server/remix/not_found_response.js";
import {getDocumentationResponseCacheHeaders} from "~/shared/docs/documentation_cache_strategy.js";

/**
 * Serve the build-time Open Graph image for a public docs or blog page path.
 */
export async function createDocumentationOpenGraphImageResponse(
    pagePath: string,
): Promise<Response> {
    const image = await loadGeneratedDocumentationOpenGraphImage(pagePath);
    if (image === null) throw notFoundResponse();

    // A Node Buffer is a valid Uint8Array body at runtime. The cast only bridges
    // @types/node's wider ArrayBufferLike generic to the DOM BodyInit definition.
    return new Response(image as unknown as BodyInit, {
        headers: {
            "content-type": "image/png",
            ...getDocumentationResponseCacheHeaders("StableMedia"),
        },
    });
}
