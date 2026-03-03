import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export async function fetchFileFromBucket(
    objectKey: string,
    bucketName: string,
    bucket: R2Bucket,
    request: Request,
    span: TracerSpan,
) {
    let nullableObject: R2Object | null;

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

                const object = await bucket.get(objectKey, {
                    range: request.headers,
                });

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

        // This is a ranged request if our object has a range and the range isn't the
        // entire file.
        const isRangedRequest =
            object.range &&
            ("offset" in object.range || "length" in object.range) &&
            !(
                (object.range.offset ?? 0) <= 0 &&
                (object.range.length ?? object.size) >= object.size
            );

        return new Response(request.method !== "HEAD" ? (object as R2ObjectBody).body : null, {
            status: isRangedRequest ? 206 : 200,
            // We need to return the same headers between here and `resizeFile()` in
            // `server/files/processor`. If you add a header here you should also add a header
            // there.
            headers: {
                "content-type": assertExists(object.httpMetadata?.contentType),
                "content-length": String(isRangedRequest ? object.range.length : object.size),
                ...(isRangedRequest
                    ? {
                          "content-range": isRangedRequest
                              ? `bytes ${object.range.offset ?? 0}-${
                                    (object.range.offset ?? 0) +
                                    (object.range.length ?? object.size) -
                                    1
                                }/${object.size}`
                              : undefined,
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
