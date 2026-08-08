import {getContentLengthAndRangeStartForR2Object} from "~/server/helpers/get_content_length_and_range_start_for_r2_object.js";
import {isIfRangeConditionSatisfied} from "~/server/helpers/is_if_range_condition_satisfied.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export async function fetchFileFromBucket(
    objectKey: string,
    bucketName: string,
    bucket: R2Bucket,
    request: Request,
    span: TracerSpan,
) {
    let nullableObject: R2Object | null;

    // Per RFC 7233 §3.1: Range is only meaningful on GET requests.
    let isRangedRequest = request.method === "GET" && request.headers.has("range");

    if (request.method === "HEAD") {
        // Create a span with the same format as the `HeadObject` span created by
        // `CloudflareR2Client`.
        nullableObject = await span.withSpan(
            `Cloudflare R2 HeadObject ${bucketName}`,
            async span => {
                span.addData({
                    cloudflare: {
                        r2: {
                            action: "HeadObject",
                            bucket: bucketName,
                            object: {key: objectKey},
                        },
                    },
                });

                const object = await bucket.head(objectKey);

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
                `Cloudflare R2 HeadObject ${bucketName} for If-Range`,
                async span => {
                    span.addData({
                        cloudflare: {
                            r2: {
                                action: "HeadObject",
                                bucket: bucketName,
                                object: {key: objectKey},
                            },
                        },
                    });

                    const object = await bucket.head(objectKey);

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
            `Cloudflare R2 GetObject ${bucketName}`,
            async span => {
                span.addData({
                    cloudflare: {
                        r2: {
                            action: "GetObject",
                            bucket: bucketName,
                            object: {key: objectKey},
                        },
                    },
                });

                const object = await bucket.get(
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
        return new Response(request.method !== "HEAD" ? "404 Not Found" : null, {
            status: 404,
            headers: {"content-type": "text/plain"},
        });
    } else {
        const object = nullableObject;

        const {contentRange, contentLength, isRangeSatisfiable} =
            getContentLengthAndRangeStartForR2Object(object);

        return new Response(request.method !== "HEAD" ? (object as R2ObjectBody).body : null, {
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
        });
    }
}
