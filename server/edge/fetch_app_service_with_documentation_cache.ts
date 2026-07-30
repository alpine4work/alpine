import {
    DocumentationCachePolicy,
    documentationCacheName,
    documentationCachePolicyResponseHeader,
    getDocumentationCacheControl,
    parseDocumentationCachePolicy,
} from "~/shared/docs/documentation_cache_strategy.js";

/**
 * Fetch AppService while caching only responses it explicitly marks as public
 * documentation data.
 *
 * Looking up every GET in a dedicated cache is safe because entries are inserted
 * only after AppService emits the shared policy marker. `UserDocument` responses
 * have no marker and can never enter this cache.
 */
export async function fetchAppServiceWithDocumentationCache({
    request,
    headers,
    executionContext,
}: {
    request: Request;
    headers: Headers;
    executionContext: ExecutionContext;
}): Promise<Response> {
    const shouldUseCache = process.env.NODE_ENV === "production" && request.method === "GET";
    const cache = shouldUseCache ? await caches.open(documentationCacheName) : null;

    if (cache !== null) {
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            const policyHeader = cachedResponse.headers.get(documentationCachePolicyResponseHeader);
            if (policyHeader !== null) {
                const policy = parseDocumentationCachePolicy(policyHeader);
                return createDocumentationClientResponse(cachedResponse, policy);
            }
            executionContext.waitUntil(cache.delete(request));
        }
    }

    // eslint-disable-next-line cyberworlds/no-global-fetch
    const response = await fetch(request, {headers});
    const policyHeader = response.headers.get(documentationCachePolicyResponseHeader);
    if (policyHeader === null) return response;
    const policy = parseDocumentationCachePolicy(policyHeader);

    const cacheResponse = response.clone();
    const clientResponse = createDocumentationClientResponse(response, policy);
    const {edgeCacheControl} = getDocumentationCacheControl(policy);
    if (
        cache !== null &&
        response.ok &&
        edgeCacheControl !== null &&
        !response.headers.has("set-cookie")
    ) {
        const cacheResponseHeaders = new Headers(cacheResponse.headers);
        cacheResponseHeaders.set("cache-control", edgeCacheControl);
        executionContext.waitUntil(
            cache.put(
                request,
                new Response(cacheResponse.body, {
                    status: cacheResponse.status,
                    statusText: cacheResponse.statusText,
                    headers: cacheResponseHeaders,
                }),
            ),
        );
    }
    return clientResponse;
}

function createDocumentationClientResponse(
    response: Response,
    policy: DocumentationCachePolicy,
): Response {
    const headers = new Headers(response.headers);
    headers.delete(documentationCachePolicyResponseHeader);
    headers.set("cache-control", getDocumentationCacheControl(policy).clientCacheControl);
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
}
