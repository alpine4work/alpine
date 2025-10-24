import {avatarsBucketName} from "~/server/helpers/avatars_cloudflare_r2_bucket_name.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {fetchFileFromBucket} from "~/server/resources/fetch_file_from_bucket.js";
import {ResourceServiceEnv} from "~/server/resources/resource_service_env.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {
    AvatarEntityPath,
    AvatarVariant,
    printAvatarEntityObjectIntoTracerRoute,
    printAvatarEntityPathIntoCloudflareR2Key,
} from "~/shared/avatar/avatar_entity_path.js";
import {getContentReferencesFileSignedUrlSearchExpirationTime} from "~/shared/content/content_references.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {AvatarId} from "~/shared/id/types/id_types.js";
import {
    getHeadersTracerData,
    obfuscateCookieHeader,
    obfuscateSetCookieHeaders,
} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// You can change the version number to bust the Cloudflare cache.
const avatarCacheName = "avatars_v1";

export async function fetchAvatar(
    executionContext: ExecutionContext,
    env: ResourceServiceEnv,
    tokenAgent: TokenAgent,
    request: Request,
    url: URL,
    span: TracerSpan,
    route: {avatarEntityPath: AvatarEntityPath; avatarId: AvatarId; variant: AvatarVariant},
): Promise<Response> {
    try {
        if (request.method !== "GET" && request.method !== "HEAD") {
            throw new InvalidArgumentError("Only `GET` and `HEAD` HTTP requests are supported");
        }

        const signedUrl = new URL(url);

        // Make sure the user is allowed to access this file by verifying the signed
        // URL. If the user tampered with the URL then we'll throw an error.
        try {
            await tokenAgent.publicSide.verifyUrl(signedUrl);
        } catch (error) {
            span.addException(error);
            return new Response("403 Forbidden", {
                status: 403,
                headers: {"content-type": "text/plain"},
            });
        }

        // We set `max-age` to a time just after our URL expires. This lets the browser
        // know it's free to discard the file from its cache after that.
        const expirationTime = getContentReferencesFileSignedUrlSearchExpirationTime(
            signedUrl.search,
        );
        const cacheControlMaxAge = Math.ceil((expirationTime - Date.now()) / 1000) + 60;

        // Use a cache specifically for files since we'll be saving private files to
        // this cache. We don't want to accidentally serve these files from another
        // request that hasn't verified the URL signature.
        const avatarsCache = await caches.open(avatarCacheName);

        try {
            const cachedResponse = await avatarsCache.match(request);
            if (cachedResponse) {
                const cachedResponseHeaders = new Headers(cachedResponse.headers);

                // 1. Make sure to switch the `public` `cache-control` directive back to
                //    `private` before returning.
                // 2. Change `max-age` to match the expiration time from our URL.
                const cacheControlResponseHeader = cachedResponseHeaders.get("cache-control");
                if (cacheControlResponseHeader) {
                    cachedResponseHeaders.set(
                        "cache-control",
                        cacheControlResponseHeader
                            .replace(/((?:^|,) *)public( *(?:,|$))/, "$1private$2")
                            .replace(
                                /((?:^|,) *)max-age=\d+( *(?:,|$))/,
                                `$1max-age=${cacheControlMaxAge}$2`,
                            ),
                    );
                }

                // If we're making a `HEAD` request then make sure we don't return a body.
                return new Response(request.method !== "HEAD" ? cachedResponse.body : null, {
                    status: cachedResponse.status,
                    headers: cachedResponseHeaders,
                });
            }
        } catch (error) {
            if (
                process.env.NODE_ENV !== "production" &&
                error instanceof Error &&
                // Detect this error from Miniflare:
                // https://github.com/cloudflare/miniflare/blob/12f6f915e08fbf3c7c5298e5131153c5e6e11d57/packages/cache/src/cache.ts#L273-L279
                //
                // Miniflare error name format:
                // https://github.com/cloudflare/miniflare/blob/12f6f915e08fbf3c7c5298e5131153c5e6e11d57/packages/shared/src/error.ts#L9
                error.name === "CacheError [ERR_DESERIALIZATION]"
            ) {
                // There's a race condition in Miniflare in development where if
                // `filesCache.put()` hasn't finished running then Miniflare will have started
                // writing to the cache but won't have written cache metadata. This causes
                // Miniflare to crash. This race condition reproduces reliably when playing a
                // video file that's not in the cache.
                //
                // If we detect this race condition then we ignore the error and treat this as
                // an uncached request.
            } else {
                throw error;
            }
        }

        const objectKey = printAvatarEntityPathIntoCloudflareR2Key(
            route.avatarEntityPath,
            route.avatarId,
            route.variant,
        );

        const response = await fetchFileFromBucket(
            objectKey,
            avatarsBucketName,
            env.AvatarsBucket,
            request,
            span,
        );

        // Cloudflare doesn't support caching partial responses. So make sure we
        // have a non-206 status code before writing to the cache.
        if (response.ok && response.status !== 206) {
            // Replace the `private` `cache-control` directive with `public`. It's safe to
            // cache avatars in `avatarsCache` since in order to access `avatarsCache` you must
            // have a valid signed URL when accessing this endpoint. We'll only generate
            // signed URLs when the user actually has access to an avatar.
            const {
                body: cacheResponseBody,
                status: cacheResponseStatus,
                headers: cacheResponseImmutableHeaders,
            } = response.clone();

            executionContext.waitUntil(
                span.withSpan("Caching fetched avatar", async cacheSpan => {
                    const cacheResponseHeaders = new Headers(cacheResponseImmutableHeaders);

                    const cacheControlResponseHeader = cacheResponseHeaders.get("cache-control");
                    if (cacheControlResponseHeader) {
                        cacheResponseHeaders.set(
                            "cache-control",
                            cacheControlResponseHeader.replace(
                                /((?:^|,) *)private( *(?:,|$))/,
                                "$1public$2",
                            ),
                        );
                    }

                    cacheSpan.addData({
                        http: {
                            service: {name: "AvatarService"},
                            route: printAvatarEntityObjectIntoTracerRoute(route.avatarEntityPath),
                            url: request.url,
                            method: request.method,
                            userAgent: request.headers.get("user-agent") ?? undefined,
                            statusCode: cacheResponseStatus,
                            request: {
                                header: getHeadersTracerData(request.headers),
                                obfuscatedCookieHeader: obfuscateCookieHeader(request.headers),
                            },
                            response: {
                                header: getHeadersTracerData(cacheResponseHeaders),
                                obfuscatedSetCookieHeader:
                                    obfuscateSetCookieHeaders(cacheResponseHeaders),
                            },
                        },
                    });

                    await avatarsCache.put(
                        request,
                        new Response(cacheResponseBody, {
                            status: cacheResponseStatus,
                            headers: cacheResponseHeaders,
                        }),
                    );
                }),
            );
        }

        const responseHeaders = new Headers(response.headers);

        // Change `max-age` to match the expiration time from our URL.
        const cacheControlResponseHeader = responseHeaders.get("cache-control");
        if (cacheControlResponseHeader) {
            responseHeaders.set(
                "cache-control",
                cacheControlResponseHeader.replace(
                    /((?:^|,) *)max-age=\d+( *(?:,|$))/,
                    `$1max-age=${cacheControlMaxAge}$2`,
                ),
            );
        }

        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders,
        });
    } catch (error) {
        span.addException(error);
        return createSimpleErrorResponse(error);
    }
}
