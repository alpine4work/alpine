import {
    getDocumentationCacheControl,
    getDocumentationStaticCachePolicy,
} from "~/shared/docs/documentation_cache_strategy.js";

export type AppStaticCacheControl = {
    clientCacheControl: string;
    edgeCacheControl: string;
};

/**
 * Cache policy for files shipped with the web app.
 *
 * Documentation-specific decisions live in `shared/docs`; this function adds the
 * policy for the remaining application files.
 */
export function getAppStaticCacheControlHeaders(pathname: string): AppStaticCacheControl {
    const documentationCachePolicy = getDocumentationStaticCachePolicy(pathname);
    if (documentationCachePolicy !== null) {
        return getDocumentationCacheControl(documentationCachePolicy);
    }

    if (
        pathname.startsWith("/fonts/") ||
        pathname.startsWith("/assets/") ||
        // NOTE(calebmer, 2024-08-20): Exists for backwards compatibility before we used
        // Vite for compilation. Can remove once clients that expect static assets under
        // `/build` no longer exist.
        pathname.startsWith("/build/")
    ) {
        // - `public`: Means we can store the asset in a shared cache since they don't
        //   depend on authorization.
        // - `max-age=31536000`: The asset lives for one year.
        // - `immutable`: Indicates the response will never update.
        return {
            clientCacheControl: "public, max-age=31536000, immutable",
            edgeCacheControl: "public, max-age=31536000, immutable",
        };
    }

    // - `public`: Means we can store the asset in a shared cache since they don't
    //   depend on authorization.
    // - `max-age=86400`: The asset lives for one day.
    // - `stale-while-revalidate=31536000`: When the asset is stale, the cache is
    //   allowed to continue using it for a year as long as the cache revalidates the
    //   asset in the background.
    return {
        clientCacheControl: "public, max-age=86400, stale-while-revalidate=31536000",
        // Cloudflare's Cache API does not implement stale directives.
        edgeCacheControl: "public, max-age=86400",
    };
}
