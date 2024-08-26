import {
    DeleteObjectCommandInput,
    DeleteObjectCommandOutput,
    GetObjectCommandInput,
    GetObjectCommandOutput,
    HeadObjectCommandInput,
    HeadObjectCommandOutput,
    PutObjectCommandInput,
    PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
// NOTE: `import type` is important here. We don't want to import Miniflare
// source files in production. We're just using the types in this module.
import type * as miniflareTypes from "@miniflare/r2";
import {NodeJsRuntimeStreamingBlobPayloadInputTypes} from "@smithy/types";
import {Readable} from "stream";
import {ReadableStream, TextDecoderStream} from "stream/web";
import {CloudflareR2ClientBase} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {InvalidArgumentError, NotFoundError, UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * A mock R2 client backed by Miniflare that we use in local development and
 * tests.
 */
export class MiniflareR2Client implements CloudflareR2ClientBase {
    private readonly _bucketByName: ReadonlyMap<string, miniflareTypes.R2Bucket>;

    constructor(bucketByName: ReadonlyMap<string, miniflareTypes.R2Bucket>) {
        // Miniflare should not be used in production! It's only used to store files in
        // development.
        assert(process.env.NODE_ENV !== "production");

        this._bucketByName = bucketByName;
    }

    private _getBucket(bucketName: string | undefined): miniflareTypes.R2Bucket {
        if (!bucketName) throw new InvalidArgumentError("R2 bucket name is undefined");
        const bucket = this._bucketByName.get(bucketName);
        if (!bucket) throw new NotFoundError("R2 bucket not found");
        return bucket;
    }

    public GetObject(
        tracer: TracerBase,
        {
            Bucket: bucketName,
            Key: key,
            IfMatch: etagMatches,
            IfNoneMatch: etagDoesNotMatch,
            IfModifiedSince: uploadedAfter,
            IfUnmodifiedSince: uploadedBefore,
            ...unrecognizedInputs
        }: GetObjectCommandInput,
    ): Promise<GetObjectCommandOutput> {
        let spanName = "Cloudflare R2 GetObject";

        if (bucketName !== undefined) {
            spanName += ` ${bucketName}`;
        }

        return tracer.withSpan(spanName, async span => {
            span.addData({
                cloudflare: {
                    r2: {
                        action: "GetObject",
                        bucket: bucketName,
                        object: {
                            key,
                        },
                    },
                },
            });

            const unrecognizedInputKeys = Object.keys(unrecognizedInputs);
            if (unrecognizedInputKeys.length > 0) {
                throw new UnimplementedError(
                    `Unrecognized input keys to \`MiniflareR2Client.GetObject\`: ${unrecognizedInputKeys
                        .map(key => JSON.stringify(key))
                        .join(", ")}`,
                );
            }

            const object = await this._getBucket(bucketName).get(assertExists(key), {
                onlyIf: {
                    etagMatches,
                    etagDoesNotMatch,
                    uploadedAfter,
                    uploadedBefore,
                },
            });

            span.addData({
                cloudflare: {
                    r2: {
                        object: {
                            contentType: object?.httpMetadata.contentType,
                        },
                    },
                },
            });

            return {
                get $metadata(): never {
                    throw new UnimplementedError(
                        "`$metadata` is unimplemented for `MiniflareR2Client`",
                    );
                },
                LastModified: object?.uploaded,
                ContentLength: object?.size,
                ETag: object?.etag,
                VersionId: object?.version,
                ContentType: object?.httpMetadata.contentType,
                ContentLanguage: object?.httpMetadata.contentLanguage,
                ContentDisposition: object?.httpMetadata.contentDisposition,
                ContentEncoding: object?.httpMetadata.contentEncoding,
                CacheControl: object?.httpMetadata.cacheControl,
                Body:
                    object !== null && "body" in object
                        ? Object.assign(Readable.fromWeb(object.body), {
                              transformToByteArray: () =>
                                  convertReadableStreamToUint8Array(object.body),
                              transformToString: (encoding?: string) =>
                                  convertReadableStreamToString(object.body, encoding),
                              transformToWebStream: () => object.body as globalThis.ReadableStream,
                          })
                        : undefined,
            };
        });
    }

    public HeadObject(
        tracer: TracerBase,
        {Bucket: bucketName, Key: key, ...unrecognizedInputs}: HeadObjectCommandInput,
    ): Promise<HeadObjectCommandOutput> {
        let spanName = "Cloudflare R2 HeadObject";

        if (bucketName !== undefined) {
            spanName += ` ${bucketName}`;
        }

        return tracer.withSpan(spanName, async span => {
            span.addData({
                cloudflare: {
                    r2: {
                        action: "HeadObject",
                        bucket: bucketName,
                        object: {
                            key,
                        },
                    },
                },
            });

            const unrecognizedInputKeys = Object.keys(unrecognizedInputs);
            if (unrecognizedInputKeys.length > 0) {
                throw new UnimplementedError(
                    `Unrecognized input keys to \`MiniflareR2Client.HeadObject\`: ${unrecognizedInputKeys
                        .map(key => JSON.stringify(key))
                        .join(", ")}`,
                );
            }

            const object = await this._getBucket(bucketName).head(assertExists(key));

            span.addData({
                cloudflare: {
                    r2: {
                        object: {
                            contentType: object?.httpMetadata.contentType,
                        },
                    },
                },
            });

            return {
                get $metadata(): never {
                    throw new UnimplementedError(
                        "`$metadata` is unimplemented for `MiniflareR2Client`",
                    );
                },
                LastModified: object?.uploaded,
                ContentLength: object?.size,
                ETag: object?.etag,
                VersionId: object?.version,
                ContentType: object?.httpMetadata.contentType,
                ContentLanguage: object?.httpMetadata.contentLanguage,
                ContentDisposition: object?.httpMetadata.contentDisposition,
                ContentEncoding: object?.httpMetadata.contentEncoding,
                CacheControl: object?.httpMetadata.cacheControl,
            };
        });
    }

    public PutObject(
        tracer: TracerBase,
        {
            Bucket: bucketName,
            Key: key,
            Body: untypedBody,
            ContentType: contentType,
            ContentLanguage: contentLanguage,
            ContentDisposition: contentDisposition,
            ContentEncoding: contentEncoding,
            CacheControl: cacheControl,
            ...unrecognizedInputs
        }: PutObjectCommandInput,
    ): Promise<PutObjectCommandOutput> {
        let spanName = "Cloudflare R2 PutObject";

        if (bucketName !== undefined) {
            spanName += ` ${bucketName}`;
        }

        return tracer.withSpan(spanName, async span => {
            span.addData({
                cloudflare: {
                    r2: {
                        action: "PutObject",
                        bucket: bucketName,
                        object: {
                            key,
                            contentType,
                        },
                    },
                },
            });

            const unrecognizedInputKeys = Object.keys(unrecognizedInputs);
            if (unrecognizedInputKeys.length > 0) {
                throw new UnimplementedError(
                    `Unrecognized input keys to \`MiniflareR2Client.PutObject\`: ${unrecognizedInputKeys
                        .map(key => JSON.stringify(key))
                        .join(", ")}`,
                );
            }

            const body = untypedBody as NodeJsRuntimeStreamingBlobPayloadInputTypes | undefined;
            assert(body);

            const object = await this._getBucket(bucketName).put(
                assertExists(key),
                body instanceof Readable ? Readable.toWeb(body) : body,
                {
                    httpMetadata: {
                        contentType,
                        contentLanguage,
                        contentDisposition,
                        contentEncoding,
                        cacheControl,
                    },
                },
            );

            return {
                get $metadata(): never {
                    throw new UnimplementedError(
                        "`$metadata` is unimplemented for `MiniflareR2Client`",
                    );
                },
                ETag: object?.etag,
                VersionId: object?.version,
            };
        });
    }

    public async DeleteObject(
        tracer: TracerBase,
        {Bucket: bucketName, Key: key, ...unrecognizedInputs}: DeleteObjectCommandInput,
    ): Promise<DeleteObjectCommandOutput> {
        let spanName = "Cloudflare R2 DeleteObject";

        if (bucketName !== undefined) {
            spanName += ` ${bucketName}`;
        }

        return tracer.withSpan(spanName, async span => {
            span.addData({
                cloudflare: {
                    r2: {
                        action: "DeleteObject",
                        bucket: bucketName,
                        object: {
                            key,
                        },
                    },
                },
            });

            const unrecognizedInputKeys = Object.keys(unrecognizedInputs);
            if (unrecognizedInputKeys.length > 0) {
                throw new UnimplementedError(
                    `Unrecognized input keys to \`MiniflareR2Client.PutObject\`: ${unrecognizedInputKeys
                        .map(key => JSON.stringify(key))
                        .join(", ")}`,
                );
            }

            await this._getBucket(bucketName).delete(assertExists(key));

            return {
                get $metadata(): never {
                    throw new UnimplementedError(
                        "`$metadata` is unimplemented for `MiniflareR2Client`",
                    );
                },
                get VersionId(): never {
                    throw new UnimplementedError(
                        "`DeleteObjectCommandOutput.VersionId` is unimplemented for `MiniflareR2Client`",
                    );
                },
            };
        });
    }
}

function concatUint8Arrays(chunks: Array<Uint8Array>): Uint8Array {
    const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
    let offset = 0;

    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }

    return result;
}

async function convertReadableStreamToUint8Array(
    stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
    const chunks: Array<Uint8Array> = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    return concatUint8Arrays(chunks);
}

async function convertReadableStreamToString(
    stream: ReadableStream<Uint8Array>,
    encoding?: string,
): Promise<string> {
    let string = "";

    for await (const chunk of stream.pipeThrough(new TextDecoderStream(encoding))) {
        string += chunk;
    }

    return string;
}
