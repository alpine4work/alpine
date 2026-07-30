import {ResourceServiceEnv} from "~/server/resources/resource_service_env.js";
import {
    getDocumentationCacheControl,
    getDocumentationStaticCachePolicy,
} from "~/shared/docs/documentation_cache_strategy.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export async function fetchAppStaticFile(
    request: Request,
    env: ResourceServiceEnv,
    executionContext: ExecutionContext,
    url: URL,
): Promise<Response> {
    // In development, static assets are served by `serve-static` middleware in
    // `AppService`. In production we serve static assets from Cloudflare R2.
    if (process.env.NODE_ENV !== "production") {
        const fetchUrl = `${assertExists(env.APP_SERVICE_URL)}${url.pathname}`;
        // eslint-disable-next-line cyberworlds/no-global-fetch
        return await fetch(fetchUrl);
    }

    const cache: Cache =
        // @ts-expect-error: `@cloudflare/workers-types` doesn't seem to be providing
        // the correct types for us.
        caches.default;
    const documentationCachePolicy = getDocumentationStaticCachePolicy(url.pathname);
    const documentationCacheControl =
        documentationCachePolicy === null
            ? null
            : getDocumentationCacheControl(documentationCachePolicy);

    // We follow R2's "[Use the Cache API][1]" example for caching R2 objects in
    // Cloudflare's global cache.
    //
    // [1]: https://developers.cloudflare.com/r2/examples/cache-api/
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
        if (documentationCacheControl === null) return cachedResponse;
        const cachedResponseHeaders = new Headers(cachedResponse.headers);
        cachedResponseHeaders.set("cache-control", documentationCacheControl.clientCacheControl);
        return new Response(cachedResponse.body, {
            status: cachedResponse.status,
            headers: cachedResponseHeaders,
        });
    }

    const object = await env.AppStaticBucket.get(`files${url.pathname}`);
    if (object === null) {
        return new Response("404 Not Found", {
            status: 404,
            headers: {"content-type": "text/plain"},
        });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);

    // Remix fingerprints its assets so we can cache them forever. Other assets (like
    // `favicon.ico`) are cached for a day then can be updated.
    //
    // We manually version our font assets so fonts can be cached forever too. If we
    // need to update a font the file name will change.
    if (
        url.pathname.startsWith("/fonts/") ||
        url.pathname.startsWith("/assets/") ||
        // NOTE(calebmer, 2024-08-20): Exists for backwards compatibility before we used
        // Vite for compilation. Can remove once clients that expect static assets under
        // `/build` no longer exist.
        url.pathname.startsWith("/build/")
    ) {
        // - `public`: Means we can store the asset in a shared cache since they don't
        //   depend on authorization.
        // - `max-age=31536000`: The asset lives for one year.
        // - `immutable`: Indicates the response will never update.
        headers.set("cache-control", "public, max-age=31536000, immutable");
    } else {
        // - `public`: Means we can store the asset in a shared cache since they don't
        //   depend on authorization.
        // - `max-age=86400`: The asset lives for one day.
        // - `stale-while-revalidate=31536000`: When the asset is stale, the cache is
        //   allowed to continue using it for a year as long as the cache revalidates the
        //   asset in the background.
        headers.set("cache-control", "public, max-age=86400, stale-while-revalidate=31536000");
    }
    if (documentationCacheControl !== null) {
        headers.set("cache-control", documentationCacheControl.clientCacheControl);
    }

    // Add CORS headers to the response for trusted domains. Only origins that are in
    // the trusted domains can access static files via CORS mode. if there is no origin
    // header, then this isn't a CORS request
    const origin = request.headers.get("Origin");
    const trustedOrigins = env.CORS_TRUSTED_ORIGINS ?? [];

    if (url.pathname.startsWith("/fonts/")) {
        // We allow all origins to access font files via CORS mode.
        headers.set("Access-Control-Allow-Origin", "*");
    } else if (origin && trustedOrigins.includes(origin)) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Vary", "Origin");
    }

    // This header will allow no-cors requests from outside the same site as the
    // request origin. Useful for embedding static files in emails.
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");

    const response = new Response(object.body, {headers});

    // Put the R2 object in Cloudflare's cache to speed up future requests.
    const cacheResponse = response.clone();
    const edgeCacheControl = documentationCacheControl?.edgeCacheControl ?? null;
    if (edgeCacheControl !== null) {
        const cacheResponseHeaders = new Headers(cacheResponse.headers);
        cacheResponseHeaders.set("cache-control", edgeCacheControl);
        executionContext.waitUntil(
            cache.put(
                request,
                new Response(cacheResponse.body, {
                    status: cacheResponse.status,
                    headers: cacheResponseHeaders,
                }),
            ),
        );
    } else {
        executionContext.waitUntil(cache.put(request, cacheResponse));
    }

    return response;
}
