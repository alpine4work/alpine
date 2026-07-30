/**
 * Fetch a public R2 object through Cloudflare's Cache API.
 *
 * The stored response uses the effective edge TTL, while every returned response
 * is rewritten to the client policy. Request-specific headers such as CORS are
 * applied after the cache lookup so one request cannot populate them for another.
 */
export async function fetchCachedR2Object({
    request,
    bucket,
    objectKey,
    executionContext,
    clientCacheControl,
    edgeCacheControl,
    setResponseHeaders,
}: {
    request: Request;
    bucket: R2Bucket;
    objectKey: string;
    executionContext: ExecutionContext;
    clientCacheControl: string;
    edgeCacheControl: string;
    setResponseHeaders?: (headers: Headers) => void;
}): Promise<Response | null> {
    const shouldUseCache = request.method === "GET";
    const cache: Cache =
        // @ts-expect-error: `@cloudflare/workers-types` doesn't seem to be providing
        // the correct types for us.
        caches.default;

    if (shouldUseCache) {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            return createClientR2Response({
                response: cachedResponse,
                requestMethod: request.method,
                clientCacheControl,
                setResponseHeaders,
            });
        }
    }

    const object = await bucket.get(objectKey);
    if (object === null) return null;

    const cacheResponseHeaders = new Headers();
    object.writeHttpMetadata(cacheResponseHeaders);
    cacheResponseHeaders.set("etag", object.httpEtag);
    cacheResponseHeaders.set("cache-control", edgeCacheControl);
    const cacheResponse = new Response(object.body, {headers: cacheResponseHeaders});
    const clientResponse = createClientR2Response({
        response: cacheResponse.clone(),
        requestMethod: request.method,
        clientCacheControl,
        setResponseHeaders,
    });

    if (shouldUseCache) {
        executionContext.waitUntil(cache.put(request, cacheResponse));
    }
    return clientResponse;
}

function createClientR2Response({
    response,
    requestMethod,
    clientCacheControl,
    setResponseHeaders,
}: {
    response: Response;
    requestMethod: string;
    clientCacheControl: string;
    setResponseHeaders?: (headers: Headers) => void;
}): Response {
    const headers = new Headers(response.headers);
    headers.set("cache-control", clientCacheControl);
    setResponseHeaders?.(headers);
    return new Response(requestMethod === "HEAD" ? null : response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
