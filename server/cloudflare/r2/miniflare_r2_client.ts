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
// NOTE: `import type` is important here. We don't want to import Miniflare source
// files in production. We're just using the types in this module.
import type * as miniflareTypes from "@miniflare/r2";
import {NodeJsRuntimeStreamingBlobPayloadInputTypes} from "@smithy/types";
import {Readable as ReadableStream, Transform as TransformStream} from "stream";
import {Headers} from "undici";
import {CloudflareR2ClientBase} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    UnimplementedError,
} from "~/shared/error/error.open_source.js";
import {waitForReadableStreamString} from "~/shared/helpers/binary/wait_for_readable_stream_string.js";
import {waitForReadableStreamUint8Array} from "~/shared/helpers/binary/wait_for_readable_stream_uint8_array.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {serializeDateString} from "~/shared/helpers/date/date_string.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {TracerBase} from "~/shared/tracer/tracer_base.open_source.js";

/**
 * A mock R2 client backed by Miniflare that we use in local development and tests.
 */
export class MiniflareR2Client implements CloudflareR2ClientBase {
    private readonly _fileProcessorServiceUrl: string;
    private readonly _bucketByName: ReadonlyMap<string, miniflareTypes.R2Bucket>;

    constructor({
        fileProcessorServiceUrl,
        bucketByName,
    }: {
        fileProcessorServiceUrl: string;
        bucketByName: ReadonlyMap<string, miniflareTypes.R2Bucket>;
    }) {
        // Miniflare should not be used in production! It's only used to store files in
        // development.
        assert(process.env.NODE_ENV !== "production");

        this._fileProcessorServiceUrl = fileProcessorServiceUrl;
        this._bucketByName = bucketByName;
    }

    public isMiniflare(): boolean {
        return true;
    }

    public isEmptyForTest() {
        return false;
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
            Range: range,
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
                range: range !== undefined ? new Headers([["range", range]]) : undefined,
            });

            if (!object) {
                throw new NotFoundError("R2 object not found", {
                    // Make sure `isCloudflareR2NoSuchKeyError()` returns true for this error.
                    cause: {Code: "NoSuchKey"},
                });
            }

            span.addData({
                cloudflare: {
                    r2: {
                        object: {
                            contentType: object?.httpMetadata.contentType,
                            contentLength: object?.size,
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
                AcceptRanges: "bytes",
                LastModified: object.uploaded,
                ContentLength: object.range?.length ?? object.size,
                ETag: object.etag,
                VersionId: object.version,
                ContentType: object.httpMetadata.contentType,
                ContentLanguage: object.httpMetadata.contentLanguage,
                ContentDisposition: object.httpMetadata.contentDisposition,
                ContentEncoding: object.httpMetadata.contentEncoding,
                CacheControl: object.httpMetadata.cacheControl,
                ContentRange: object.range
                    ? `bytes ${object.range.offset ?? 0}-${
                          (object.range.offset ?? 0) + (object.range.length ?? 0) - 1
                      }/${object.size}`
                    : undefined,
                Body:
                    "body" in object
                        ? Object.assign(ReadableStream.fromWeb(object.body), {
                              transformToByteArray: () =>
                                  waitForReadableStreamUint8Array(
                                      object.body as globalThis.ReadableStream<Uint8Array>,
                                  ),
                              transformToString: (encoding?: string) =>
                                  waitForReadableStreamString(
                                      object.body as globalThis.ReadableStream<
                                          Uint8Array<ArrayBuffer>
                                      >,
                                      encoding,
                                  ),
                              transformToWebStream: () =>
                                  object.body as globalThis.ReadableStream<Uint8Array>,
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

            if (!object) {
                throw new NotFoundError("R2 object not found", {
                    // Make sure `isCloudflareR2NoSuchKeyError()` returns true for this error.
                    cause: {Code: "NoSuchKey"},
                });
            }

            span.addData({
                cloudflare: {
                    r2: {
                        object: {
                            contentType: object.httpMetadata.contentType,
                            contentLength: object.size,
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
                LastModified: object.uploaded,
                ContentLength: object.size,
                ETag: object.etag,
                VersionId: object.version,
                ContentType: object.httpMetadata.contentType,
                ContentLanguage: object.httpMetadata.contentLanguage,
                ContentDisposition: object.httpMetadata.contentDisposition,
                ContentEncoding: object.httpMetadata.contentEncoding,
                CacheControl: object.httpMetadata.cacheControl,
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
            ContentLength: contentLength,
            ContentLanguage: contentLanguage,
            ContentDisposition: contentDisposition,
            ContentEncoding: contentEncoding,
            CacheControl: cacheControl,
            IfNoneMatch: ifNoneMatch,
            ...unrecognizedInputs
        }: PutObjectCommandInput,
        {signal}: {signal?: AbortSignal} = {},
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
                            contentLength,
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

            let body = untypedBody as NodeJsRuntimeStreamingBlobPayloadInputTypes | undefined;
            assert(body);

            let streamContentLength = 0;

            if (body instanceof ReadableStream) {
                if (typeof contentLength !== "number") {
                    throw new InternalError(
                        "`Content-Length` header is required when calling `PutObject()` with a stream body",
                    );
                }

                body = body.pipe(
                    // NOTE(calebmer): I have no idea why but sometimes `put()` calls for large audio
                    // files aren't finishing even though the stream has been fully read unless there's
                    // a pass-through stream here. My best guess is Miniflare is checking to see if the
                    // stream is an HTTP request stream and doing something differently that isn't
                    // terminating?
                    new TransformStream({
                        transform: (chunk: Buffer, encoding, callback) => {
                            streamContentLength += chunk.length;
                            callback(null, chunk);
                        },
                    }),
                );

                signal?.addEventListener("abort", () => {
                    assert(body instanceof ReadableStream);
                    body.destroy(signal.reason);
                });
            }

            const object = await this._getBucket(bucketName).put(
                assertExists(key),
                body instanceof ReadableStream ? ReadableStream.toWeb(body) : body,
                {
                    onlyIf: ifNoneMatch ? new Headers([["If-None-Match", "*"]]) : undefined,
                    httpMetadata: {
                        contentType,
                        contentLanguage,
                        contentDisposition,
                        contentEncoding,
                        cacheControl,
                    },
                },
            );

            if (body instanceof ReadableStream && streamContentLength !== contentLength) {
                throw new InternalError(
                    quote`\`Content-Length\` header is ${contentLength} byte(s) but the stream body had ${streamContentLength} byte(s)`,
                );
            }

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

        return await tracer.withSpan(spanName, async span => {
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

    public getGetObjectSignedUrl(
        tracer: TracerBase,
        expirationTime: Date,
        input: GetObjectCommandInput,
    ) {
        let spanName = "Cloudflare R2 sign URL for GetObject";

        if (input.Bucket !== undefined) {
            spanName += ` ${input.Bucket}`;
        }

        return tracer.withSpan(spanName, async span => {
            span.addData({
                cloudflare: {
                    r2: {
                        action: "GetObject",
                        bucket: input.Bucket,
                        object: {
                            key: input.Key,
                        },
                    },
                },
            });

            // Make sure the bucket name is valid to add to a URL:
            // https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html#general-purpose-bucket-names
            const bucketName = input.Bucket ?? "";
            assert(/^[a-z0-9.-]{3,63}$/.test(bucketName));

            const key = encodeURIComponent(input.Key ?? "");

            const expirationTimeString = serializeDateString(expirationTime);

            // `FileProcessorService` has an internal route for mocking signed URLs in
            // development. This route is completely insecure and must not work in production.
            // In production we'll generate actual S3 compatible signed URLs.
            return `${this._fileProcessorServiceUrl}/internal/miniflare/get-object/${bucketName}/${key}?exp=${expirationTimeString}`;
        });
    }
}
