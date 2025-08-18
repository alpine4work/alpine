import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export interface PutR2ObjectBucketInterface {
    put(
        key: string,
        body: any,
        options: {httpMetadata: {contentType: string; contentLength?: number}},
    ): Promise<unknown>;
}

// TODO(ifitzsimmons, 2025-08-15): Update our R2 clients such that they always call the APIs
// with a span: https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/xrh8rtamm3svckc1p5j4gta9rr
export async function putR2ObjectWithSpan(
    span: TracerSpan,
    {
        key,
        body,
        contentType,
        contentLength,
        bucketName,
        bucket,
    }: {
        key: string;
        body: any;
        contentType: string;
        contentLength: number;
        bucketName: string;
        bucket: PutR2ObjectBucketInterface;
    },
) {
    // Create a span with the same format as the `PutObject` span created by
    // `CloudflareR2Client`.
    await span.withSpan(`Cloudflare R2 PutObject ${bucketName}`, span => {
        span.addData({
            cloudflare: {
                r2: {
                    action: "PutObject",
                    bucket: bucketName,
                    object: {
                        key,
                        contentType,
                        contentLength,
                    },
                },
            },
        });

        return bucket.put(key, body, {
            httpMetadata: {contentType},
        });
    });
}
