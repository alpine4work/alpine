import {EdgeServiceEnv} from "~/server/edge/edge_service_env.js";
import {createSimpleErrorResponse} from "~/server/helpers/create_simple_error_response.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {getContentLengthAndRangeStartForR2Object} from "~/server/helpers/get_content_length_and_range_start_for_r2_object.js";
import {isIfRangeConditionSatisfied} from "~/server/helpers/is_if_range_condition_satisfied.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {getContentReferencesFileSignedUrlSearchExpirationTime} from "~/shared/content/content_references.js";
import {
    InternalError,
    InvalidArgumentError,
    PermissionDeniedError,
} from "~/shared/error/error.open_source.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {
    getFilePreviewImageResizeWidth,
    isFilePreviewImageResizeWidth,
} from "~/shared/files/get_file_preview_image_resize_width.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {
    fetchWithTracer,
    getHeadersTracerData,
    obfuscateCookieHeader,
    obfuscateSetCookieHeaders,
} from "~/shared/tracer/fetch_with_tracer.open_source.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

// You can change the version number to bust the Cloudflare file resize cache.
const fileCacheName = "files_v2";

export async function fetchFile(
    executionContext: ExecutionContext,
    env: EdgeServiceEnv,
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

        // Make sure the user is allowed to access this file by verifying the signed URL.
        // If the user tampered with the URL then we'll throw an error.
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

        // Use a system actor for our resize action. We've already verified the user has
        // access to this URL after calling `verifyUrl()`.
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

        // We set `max-age` to a time just after our URL expires. This lets the browser
        // know it's free to discard the file from its cache after that.
        const expirationTime = getContentReferencesFileSignedUrlSearchExpirationTime(
            signedUrl.search,
        );
        const cacheControlMaxAge = Math.ceil((expirationTime - Date.now()) / 1000) + 60;

        // Use a cache specifically for files since we'll be saving private files to this
        // cache. We don't want to accidentally serve these files from another request that
        // hasn't verified the URL signature.
        const filesCache = await caches.open(fileCacheName);

        try {
            const cachedResponse = await filesCache.match(subrequest);
            if (cachedResponse) {
                const cachedResponseHeaders = new Headers(cachedResponse.headers);

                // 1. Make sure to switch the `public` `cache-control` directive back to `private`
                //    before returning.
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
                // There's a race condition in Miniflare in development where if `filesCache.put()`
                // hasn't finished running then Miniflare will have started writing to the cache
                // but won't have written cache metadata. This causes Miniflare to crash. This race
                // condition reproduces reliably when playing a video file that's not in the cache.
                //
                // If we detect this race condition then we ignore the error and treat this as an
                // uncached request.
            } else {
                throw error;
            }
        }

        let response: Response;

        // If a `width` search param wasn't provided then we return the file as-is without
        // resizing. So if `width` was provided then execute our resize request against
        // file processor service. Otherwise directly read the file from R2.
        //
        // We use the resize request as a cache key regardless of whether we actually need
        // to execute the resize.
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
                        // NOTE(ifitzsimmons, 2025-09-15): We expect the file processor to return either
                        // `image/avif` or `text/plain` for most responses. However, if the infra fails
                        // (ie, the lambda times out), we return a JSON response with the serialized error.
                        // This is necessary for cases where we want to add displayMessages to errors on
                        // the backend.
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

            let nullableObject: R2Object | null;

            // Per RFC 7233 §3.1: Range is only meaningful on GET requests.
            let isRangedRequest = request.method === "GET" && request.headers.has("range");

            if (request.method === "HEAD") {
                // Create a span with the same format as the `HeadObject` span created by
                // `CloudflareR2Client`.
                nullableObject = await span.withSpan(
                    `Cloudflare R2 HeadObject ${filesBucketName}`,
                    async span => {
                        span.addData({
                            cloudflare: {
                                r2: {
                                    action: "HeadObject",
                                    bucket: filesBucketName,
                                    object: {key: objectKey},
                                },
                            },
                        });

                        const object = await env.FilesBucket.head(objectKey);

                        if (object) {
                            span.addData({
                                cloudflare: {
                                    r2: {
                                        object: {
                                            contentType: object.httpMetadata?.contentType,
                                            contentLength: object.size,
                                        },
                                    },
                                },
                            });
                        }

                        return object;
                    },
                );
            } else {
                const ifRange = request.headers.get("if-range");

                // If `If-Range` is present, evaluate the precondition by head-ing the object
                // first. If the precondition is not satisfied, we'll treat the request as a
                // non-ranged request, even if the request has a `Range` header.
                //
                // [RFC 7233 §3.2] https://httpwg.org/specs/rfc7233.html#rfc.section.3.2
                if (isRangedRequest && ifRange !== null) {
                    const headObject = await span.withSpan(
                        `Cloudflare R2 HeadObject ${filesBucketName} for If-Range`,
                        async span => {
                            span.addData({
                                cloudflare: {
                                    r2: {
                                        action: "HeadObject",
                                        bucket: filesBucketName,
                                        object: {key: objectKey},
                                    },
                                },
                            });

                            const object = await env.FilesBucket.head(objectKey);

                            if (object) {
                                span.addData({
                                    cloudflare: {
                                        r2: {
                                            object: {
                                                contentType: object.httpMetadata?.contentType,
                                                contentLength: object.size,
                                            },
                                        },
                                    },
                                });
                            }

                            return object;
                        },
                    );

                    if (!headObject || !isIfRangeConditionSatisfied(headObject, ifRange)) {
                        isRangedRequest = false;
                    }
                }

                // Create a span with the same format as the `GetObject` span created by
                // `CloudflareR2Client`.
                nullableObject = await span.withSpan(
                    `Cloudflare R2 GetObject ${filesBucketName}`,
                    async span => {
                        span.addData({
                            cloudflare: {
                                r2: {
                                    action: "GetObject",
                                    bucket: filesBucketName,
                                    object: {key: objectKey},
                                },
                            },
                        });

                        const object = await env.FilesBucket.get(
                            objectKey,
                            isRangedRequest ? {range: request.headers} : undefined,
                        );

                        if (object) {
                            span.addData({
                                cloudflare: {
                                    r2: {
                                        object: {
                                            contentType: object.httpMetadata?.contentType,
                                            contentLength: object.size,
                                        },
                                    },
                                },
                            });
                        }

                        return object;
                    },
                );
            }

            if (!nullableObject) {
                response = new Response(request.method !== "HEAD" ? "404 Not Found" : null, {
                    status: 404,
                    headers: {"content-type": "text/plain"},
                });
            } else {
                const object = nullableObject;

                const {contentRange, contentLength, isRangeSatisfiable} =
                    getContentLengthAndRangeStartForR2Object(object);

                response = new Response(
                    request.method !== "HEAD" ? (object as R2ObjectBody).body : null,
                    {
                        // The Range Request spec [RFC 7233 §4.1] requires that a server always respond
                        // with `206 Partial Content` and a `Content-Range` header if the client sent a
                        // `Range` header, even if the range covers the entire object. Chrome and Firefox
                        // are both lenient about this, but Safari is not and returning a 200 in that case
                        // will cause issues when loading media files in Safari.
                        //
                        // [RFC 7233 §4.1] https://httpwg.org/specs/rfc7233.html#rfc.section.4.1
                        status: isRangedRequest ? (isRangeSatisfiable ? 206 : 416) : 200,
                        // We need to return the same headers between here and `resizeFile()` in
                        // `server/files/processor`. If you add a header here you should also add a header
                        // there.
                        headers: {
                            "content-type": assertExists(object.httpMetadata?.contentType),
                            "content-length": String(contentLength),
                            ...(isRangedRequest
                                ? {
                                      "content-range": contentRange,
                                  }
                                : {}),
                            // Advertise that our server supports range requests. We only support range
                            // requests when there's no `width` parameter.
                            "accept-ranges": "bytes",
                            // After resizing, the result should be cached.
                            //
                            // - `private`: A user can only see files they have access to. Don't store files in
                            //   a shared cache since an attacker may be able to see a file they don't have
                            //   access to.
                            //
                            // - `immutable`: Files are immutable after they've been uploaded. While hitting
                            //   this route will resize the file on demand causing the bytes to not be strictly
                            //   the same over time, the perceived result to the end user will never change so
                            //   it's safe to cache this response as an immutable value.
                            //
                            // - `max-age`: Keep our response cached for 30 days. It's fine to get rid of the
                            //   file after that and request again if needed.
                            "cache-control": `private, immutable, max-age=${60 * 60 * 24 * 30}`,
                        },
                    },
                );
            }
        }

        // Cloudflare doesn't support caching partial responses. So make sure we have a
        // non-206 status code before writing to the cache.
        if (response.ok && response.status !== 206) {
            // Replace the `private` `cache-control` directive with `public`. It's safe to
            // cache files in `filesCache` since in order to access `filesCache` you must have
            // a valid signed URL when accessing this endpoint. We'll only generate signed URLs
            // when the user actually has access to a file.
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
                        cacheResponseHeaders.set(
                            "cache-control",
                            cacheControlResponseHeader.replace(
                                /((?:^|,) *)private( *(?:,|$))/,
                                "$1public$2",
                            ),
                        );
                    }

                    // Make sure to remove any `set-cookie` header that might be set by our AWS load
                    // balancer since it'll break Cloudflare caching.
                    //
                    // https://developers.cloudflare.com/cache/concepts/default-cache-behavior
                    cacheResponseHeaders.delete("set-cookie");

                    // We use the resize request as a cache key regardless of whether we actually need
                    // to execute the resize. Which is why the URL will be `/:spaceId/resize/:fileId`
                    // even if we're not resizing the file and instead reading directly from Cloudflare
                    // R2.
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
