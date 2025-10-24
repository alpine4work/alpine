import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {fetchFileFromBucket} from "~/server/resources/fetch_file_from_bucket.js";
import {ResourceServiceEnv} from "~/server/resources/resource_service_env.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {getContentReferencesFileSignedUrlSearchExpirationTime} from "~/shared/content/content_references.js";
import {InternalError, InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {
    getFilePreviewImageResizeWidth,
    isFilePreviewImageResizeWidth,
} from "~/shared/files/get_file_preview_image_resize_width.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    fetchWithTracer,
    getHeadersTracerData,
    obfuscateCookieHeader,
    obfuscateSetCookieHeaders,
} from "~/shared/tracer/fetch_with_tracer.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// You can change the version number to bust the Cloudflare file resize cache.
const fileCacheName = "files_v2";

export async function fetchUploadedFile(
    executionContext: ExecutionContext,
    env: ResourceServiceEnv,
    tokenAgent: TokenAgent,
    request: Request,
    url: URL,
    span: TracerSpan,
    route: {spaceId: SpaceId; fileId: FileId},
): Promise<Response> {
    try {
        if (request.method !== "GET" && request.method !== "HEAD") {
            throw new InvalidArgumentError("Only `GET` and `HEAD` HTTP requests are supported");
        }

        const fileProcessorServiceUrl = env.FILE_PROCESSOR_SERVICE_URL;
        if (!fileProcessorServiceUrl)
            throw new InternalError("Missing `FILE_PROCESSOR_SERVICE_URL` env variable");

        const signedUrl = new URL(url);

        // Don't include the `width` and `variant` search parameters in the signed URL
        // verification. Clients are allowed to vary this argument.
        const widthString = signedUrl.searchParams.get("width");
        const variant = signedUrl.searchParams.get("variant");
        signedUrl.searchParams.delete("width");
        signedUrl.searchParams.delete("variant");

        const width = widthString !== null ? parseInt(widthString, 10) : null;
        if (width !== null && !isFilePreviewImageResizeWidth(width)) {
            throw new InvalidArgumentError(
                `Search param \`width\` is not a valid resize width, the nearest valid resize width is ${getFilePreviewImageResizeWidth(
                    width,
                )}`,
            );
        }

        if (variant !== null && variant !== "preview" && variant !== "alternative") {
            throw new InvalidArgumentError(`Search param \`variant\` is not a valid file variant`);
        }

        // Make sure the user is allowed to access this file by verifying the signed
        // URL. If the user tampered with the URL then we'll throw an error.
        try {
            await tokenAgent.publicSide.verifyUrl(signedUrl);
        } catch (error) {
            if (!(error instanceof PermissionDeniedError)) {
                throw error;
            } else {
                return new Response("401 Unauthorized", {
                    status: 401,
                    headers: {"content-type": "text/plain"},
                });
            }
        }

        const headers = new Headers(request.headers);
        addTracerPropagationContextHeader(headers, span);

        // We authenticate with an `Authorization` not a `Cookie` header.
        headers.delete("cookie");

        // Use a system actor for our resize action. We've already verified the user
        // has access to this URL after calling `verifyUrl()`.
        const token = await tokenAgent.privateSide.dangerouslySignShortLivedToken(
            "FileProcessorService",
            {type: "System", spaceId: route.spaceId},
        );
        headers.set("authorization", `bearer ${token}`);

        const subrequestUrl = new URL(
            `${fileProcessorServiceUrl}/${route.spaceId}/resize/${route.fileId}`,
        );

        const subrequestServiceName = "FileProcessorService";
        const subrequestRoute = "/:spaceId/resize/:fileId";

        if (variant !== null) subrequestUrl.searchParams.set("variant", variant);
        if (width !== null) subrequestUrl.searchParams.set("width", String(width));

        const subrequest = new Request(subrequestUrl, {
            method: request.method,
            headers,
        });

        const filesCache = await caches.open(fileCacheName);

        // We set `max-age` to a time just after our URL expires. This lets the browser
        // know it's free to discard the file from its cache after that.
        const expirationTime = getContentReferencesFileSignedUrlSearchExpirationTime(url.search);
        const cacheControlMaxAge = Math.ceil((expirationTime - Date.now()) / 1000) + 60;

        try {
            const cachedResponse = await filesCache.match(request);
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

        let response: Response;

        // If a `width` search param wasn't provided then we return the file as-is
        // without resizing. So if `width` was provided then execute our resize
        // request against file processor service. Otherwise directly read the file
        // from R2.
        //
        // We use the resize request as a cache key regardless of whether we actually
        // need to execute the resize.
        if (width !== null) {
            response = await fetchWithTracer(
                span,
                subrequestUrl,
                {
                    serviceName: subrequestServiceName,
                    route: subrequestRoute,
                    headers: subrequest.headers,
                    method: subrequest.method,
                },
                async response => {
                    const contentType = response.headers.get("content-type");

                    if (!contentType) {
                        throw new InternalError("Missing `Content-Type` header");
                    } else if (contentType === "application/json") {
                        // NOTE(ifitzsimmons, 2025-09-15): We expect the file processor to return
                        // either `image/avif` or `text/plain` for most responses. However, if
                        // the infra fails (ie, the lambda times out), we return a JSON response
                        // with the serialized error. This is necessary for cases where we want to
                        // add displayMessages to errors on the backend.
                        const body = await response.json();
                        let responseError;
                        try {
                            responseError = ErrorSchema.deserialize(body.error);
                        } catch {
                            throw new InternalError("Unexpected JSON response from file processor");
                        }

                        throw responseError;
                    } else {
                        return response;
                    }
                },
            );
        } else {
            const objectKey = `${route.spaceId}/${route.fileId}${
                variant !== null ? `-${variant}` : ""
            }`;

            response = await fetchFileFromBucket(
                objectKey,
                filesBucketName,
                env.FilesBucket,
                request,
                span,
            );
        }
        // Cloudflare doesn't support caching partial responses. So make sure we
        // have a non-206 status code before writing to the cache.
        if (response.ok && response.status !== 206) {
            const {
                body: cacheResponseBody,
                status: cacheResponseStatus,
                headers: cacheResponseImmutableHeaders,
            } = response.clone();

            executionContext.waitUntil(
                span.withSpan("Caching fetched file", async cacheSpan => {
                    const cacheResponseHeaders = new Headers(cacheResponseImmutableHeaders);

                    const cacheControlResponseHeader = cacheResponseHeaders.get("cache-control");
                    if (cacheControlResponseHeader) {
                        // Replace the `private` `cache-control` directive with `public`. It's safe to
                        // cache files in `filesCache` since in order to access `filesCache` you must
                        // have a valid signed URL when accessing this endpoint. We'll only generate
                        // signed URLs when the user actually has access to a file.
                        cacheResponseHeaders.set(
                            "cache-control",
                            cacheControlResponseHeader.replace(
                                /((?:^|,) *)private( *(?:,|$))/,
                                "$1public$2",
                            ),
                        );
                    }

                    // Make sure to remove any `set-cookie` header that might be set by our AWS
                    // load balancer since it'll break Cloudflare caching.
                    //
                    // https://developers.cloudflare.com/cache/concepts/default-cache-behavior
                    cacheResponseHeaders.delete("set-cookie");

                    // We use the resize request as a cache key regardless of whether we actually
                    // need to execute the resize. Which is why the URL will be
                    // `/:spaceId/resize/:fileId` even if we're not resizing the file and instead
                    // reading directly from Cloudflare R2.
                    cacheSpan.addData({
                        http: {
                            service: {name: subrequestServiceName},
                            route: subrequestRoute,
                            url: subrequest.url,
                            method: subrequest.method,
                            userAgent: subrequest.headers.get("user-agent") ?? undefined,
                            statusCode: cacheResponseStatus,
                            request: {
                                header: getHeadersTracerData(subrequest.headers),
                                obfuscatedCookieHeader: obfuscateCookieHeader(subrequest.headers),
                            },
                            response: {
                                header: getHeadersTracerData(cacheResponseHeaders),
                                obfuscatedSetCookieHeader:
                                    obfuscateSetCookieHeaders(cacheResponseHeaders),
                            },
                        },
                    });

                    await filesCache.put(
                        subrequest,
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
