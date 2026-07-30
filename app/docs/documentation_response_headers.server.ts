import {getDocumentationResponseCacheHeaders} from "~/shared/docs/documentation_cache_strategy.js";

/**
 * Cache public generated docs briefly in browsers and for a week at Cloudflare.
 */
export function getDocumentationResponseHeaders(): HeadersInit {
    return getDocumentationResponseCacheHeaders("GeneratedMetadata");
}

/**
 * Keep the request-specific root loader shell out of browser and shared document
 * caches, even though the documentation content itself is public.
 *
 * See https://v2.remix.run/docs/route/headers/.
 */
export function documentationRouteHeaders(): Headers {
    return new Headers(getDocumentationResponseCacheHeaders("UserDocument"));
}
