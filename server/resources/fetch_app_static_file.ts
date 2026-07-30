import {getAppStaticCacheControlHeaders} from "~/app/static/get_app_static_cache_control_headers.js";
import {fetchCachedR2Object} from "~/server/cloudflare/fetch_cached_r2_object.js";
import {ResourceServiceEnv} from "~/server/resources/resource_service_env.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * Fetch and cache a bundled static file from its environment-specific source.
 */
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

    const {clientCacheControl, edgeCacheControl} = getAppStaticCacheControlHeaders(url.pathname);
    const response = await fetchCachedR2Object({
        request,
        bucket: env.AppStaticBucket,
        objectKey: `files${url.pathname}`,
        executionContext,
        clientCacheControl,
        edgeCacheControl,
        setResponseHeaders: headers => {
            setAppStaticCorsHeaders(headers, request, env, url);
        },
    });
    if (response === null) {
        return new Response("404 Not Found", {
            status: 404,
            headers: {"content-type": "text/plain"},
        });
    }
    return response;
}

function setAppStaticCorsHeaders(
    headers: Headers,
    request: Request,
    env: ResourceServiceEnv,
    url: URL,
): void {
    // Cache entries contain only origin-independent headers. Also clear values written
    // by older deployments before applying this request's CORS policy.
    headers.delete("Access-Control-Allow-Origin");
    const vary = headers.get("Vary");
    if (vary !== null) {
        const varyValues = vary
            .split(",")
            .map(value => value.trim())
            .filter(value => value.toLowerCase() !== "origin");
        if (varyValues.length === 0) {
            headers.delete("Vary");
        } else {
            headers.set("Vary", varyValues.join(", "));
        }
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
}
