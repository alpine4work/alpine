import {
    DeleteObjectCommand,
    DeleteObjectCommandInput,
    DeleteObjectCommandOutput,
    GetObjectCommand,
    GetObjectCommandInput,
    GetObjectCommandOutput,
    HeadObjectCommand,
    HeadObjectCommandInput,
    HeadObjectCommandOutput,
    PutObjectCommand,
    PutObjectCommandInput,
    PutObjectCommandOutput,
    S3Client,
} from "@aws-sdk/client-s3";
import {getSignedUrl} from "@aws-sdk/s3-request-presigner";
import {CancelledError, ErrorBase, UnknownError} from "~/shared/error/error.js";
import {ErrorCode} from "~/shared/error/error_code.js";
import {getErrorConstructorForCode} from "~/shared/error/get_error_constructor_for_code.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

// This Cloudflare R2 client uses the Node.js AWS SDK so shouldn't be used in
// a Cloudflare Worker. In a Cloudflare Worker there's the `R2Bucket` binding
// you should use.
assert(process.versions.node);

export interface CloudflareR2ClientBase {
    /**
     * Returns true if this is the Miniflare Cloudflare R2 client.
     */
    isMiniflare(): boolean;

    /**
     * Is this `TestEmptyCloudflareR2Client`? Used in unit tests without Cloudflare
     * R2 access.
     */
    isEmptyForTest(): boolean;

    /**
     * S3 [`GetObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    GetObject(
        tracer: TracerBase,
        input: GetObjectCommandInput,
        options?: {signal?: AbortSignal},
    ): Promise<GetObjectCommandOutput>;

    /**
     * S3 [`HeadObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    HeadObject(tracer: TracerBase, input: HeadObjectCommandInput): Promise<HeadObjectCommandOutput>;

    /**
     * S3 [`PutObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    PutObject(
        tracer: TracerBase,
        input: PutObjectCommandInput,
        options?: {signal?: AbortSignal},
    ): Promise<PutObjectCommandOutput>;

    /**
     * S3 [`DeleteObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    DeleteObject(
        tracer: TracerBase,
        input: DeleteObjectCommandInput,
    ): Promise<DeleteObjectCommandOutput>;

    /**
     * Get a [pre-signed URL][1] for the S3 [`GetObject`][2] action that'll expire
     * at the provided expiration time.
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
     * [2]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
     */
    getGetObjectSignedUrl(
        tracer: TracerBase,
        expirationTime: Date,
        input: GetObjectCommandInput,
    ): Promise<string>;
}

/**
 * Client to [Cloudflare's R2 object storage service][1].
 *
 * Our client class provides automatic tracing for Cloudflare actions. The API
 * style is similar to `DynamoClientInternal`.
 *
 * [1]: https://developers.cloudflare.com/r2/
 */
export class CloudflareR2Client implements CloudflareR2ClientBase {
    // We use an AWS S3 client for accessing Cloudflare R2 (which is API compatible
    // with S3) because the S3 client is well known and well maintained. Cloudflare
    // does not provide their own client for Node.js besides the [client available
    // in Cloudflare Workers][1].
    //
    // Directly making HTTP requests with `aws4fetch` isn't convenient since [HTTP
    // responses from Cloudflare R2 are in XML][2].
    //
    // [1]: https://developers.cloudflare.com/r2/api/workers/workers-api-usage/
    // [2]: https://developers.cloudflare.com/r2/examples/aws/aws4fetch/
    private readonly _client: S3Client;

    constructor({
        accountId,
        accessKeyId,
        secretAccessKey,
        endpointOverrideForTest,
    }: {
        accountId: string;
        accessKeyId: string;
        secretAccessKey: string;
        endpointOverrideForTest?: string;
    }) {
        if (!import.meta.jest) {
            assert(endpointOverrideForTest === undefined);
        }

        this._client = new S3Client({
            region: "auto",
            endpoint: endpointOverrideForTest ?? `https://${accountId}.r2.cloudflarestorage.com`,
            ...(endpointOverrideForTest !== undefined
                ? {
                      endpointProvider: params => ({
                          url: new URL(
                              params.Bucket !== undefined ? `/${params.Bucket}` : "/",
                              endpointOverrideForTest,
                          ),
                      }),
                  }
                : {}),
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });
    }

    public isMiniflare() {
        return false;
    }

    public isEmptyForTest() {
        return false;
    }

    public destroyForTest() {
        assert(import.meta.jest);
        this._client.destroy();
    }

    /**
     * S3 [`GetObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public GetObject(
        tracer: TracerBase,
        input: GetObjectCommandInput,
        {signal}: {signal?: AbortSignal} = {},
    ): Promise<GetObjectCommandOutput> {
        let spanName = "Cloudflare R2 GetObject";

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

            const output = await this._client
                .send(new GetObjectCommand(input), {abortSignal: signal})
                .catch(rethrowClassifiedCloudflareR2Error);

            span.addData({
                cloudflare: {
                    r2: {
                        object: {
                            contentType: output.ContentType,
                            contentLength: output.ContentLength,
                        },
                    },
                },
            });

            return output;
        });
    }

    /**
     * S3 [`HeadObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public HeadObject(
        tracer: TracerBase,
        input: HeadObjectCommandInput,
    ): Promise<HeadObjectCommandOutput> {
        let spanName = "Cloudflare R2 HeadObject";

        if (input.Bucket !== undefined) {
            spanName += ` ${input.Bucket}`;
        }

        return tracer.withSpan(spanName, async span => {
            span.addData({
                cloudflare: {
                    r2: {
                        action: "HeadObject",
                        bucket: input.Bucket,
                        object: {
                            key: input.Key,
                        },
                    },
                },
            });

            const output = await this._client
                .send(new HeadObjectCommand(input))
                .catch(rethrowClassifiedCloudflareR2Error);

            span.addData({
                cloudflare: {
                    r2: {
                        object: {
                            contentType: output.ContentType,
                            contentLength: output.ContentLength,
                        },
                    },
                },
            });

            return output;
        });
    }

    /**
     * S3 [`PutObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public PutObject(
        tracer: TracerBase,
        input: PutObjectCommandInput,
        {signal}: {signal?: AbortSignal} = {},
    ): Promise<PutObjectCommandOutput> {
        let spanName = "Cloudflare R2 PutObject";

        if (input.Bucket !== undefined) {
            spanName += ` ${input.Bucket}`;
        }

        return tracer.withSpan(spanName, span => {
            span.addData({
                cloudflare: {
                    r2: {
                        action: "PutObject",
                        bucket: input.Bucket,
                        object: {
                            key: input.Key,
                            contentType: input.ContentType,
                            contentLength: input.ContentLength,
                        },
                    },
                },
            });

            return this._client
                .send(new PutObjectCommand(input), {abortSignal: signal})
                .catch(rethrowClassifiedCloudflareR2Error);
        });
    }

    /**
     * S3 [`DeleteObject`][1] action. See [Cloudflare R2 S3 API compatibility
     * notes][2].
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObject.html
     * [2]: https://developers.cloudflare.com/r2/api/s3/api/
     */
    public DeleteObject(
        tracer: TracerBase,
        input: DeleteObjectCommandInput,
    ): Promise<DeleteObjectCommandOutput> {
        let spanName = "Cloudflare R2 DeleteObject";

        if (input.Bucket !== undefined) {
            spanName += ` ${input.Bucket}`;
        }

        return tracer.withSpan(spanName, span => {
            span.addData({
                cloudflare: {
                    r2: {
                        action: "DeleteObject",
                        bucket: input.Bucket,
                        object: {
                            key: input.Key,
                        },
                    },
                },
            });

            return this._client
                .send(new DeleteObjectCommand(input))
                .catch(rethrowClassifiedCloudflareR2Error);
        });
    }

    /**
     * Get a [pre-signed URL][1] for the S3 [`GetObject`][2] action that'll expire
     * at the provided expiration time.
     *
     * [1]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/ShareObjectPreSignedURL.html
     * [2]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
     */
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

            return getSignedUrl(this._client, new GetObjectCommand(input), {
                expiresIn: (expirationTime.getTime() - Date.now()) / 1000,
            });
        });
    }
}

function rethrowClassifiedCloudflareR2Error(error: unknown): never {
    throw classifyCloudflareR2Error(error);
}

function classifyCloudflareR2Error(error: unknown): ErrorBase {
    if (
        isObject(error) &&
        typeof error.message === "string" &&
        error.message.startsWith("Request aborted")
    ) {
        return new CancelledError(error.message);
    }

    const originalErrorCode = isObject(error) && typeof error.Code === "string" ? error.Code : null;

    let errorCode: ErrorCode | null = null;
    if (originalErrorCode === "NoSuchKey") {
        errorCode = ErrorCode.NotFound;
    } else if (originalErrorCode === "InternalError") {
        errorCode = ErrorCode.Internal;
    } else if (
        originalErrorCode === "PreconditionFailed" ||
        originalErrorCode === "ConditionalRequestConflict"
    ) {
        errorCode = ErrorCode.FailedPrecondition;
    }

    const message = `Cloudflare R2 ${
        originalErrorCode !== null ? JSON.stringify(originalErrorCode) : "unknown error"
    }${isObject(error) && typeof error.message === "string" ? `: ${error.message}` : ""}`;

    if (errorCode !== null) {
        const ErrorConstructor = getErrorConstructorForCode(errorCode);
        return new ErrorConstructor(message, {
            // Return a non-Error object for `cause` so we don't include the same error
            // twice in logging.
            cause: originalErrorCode !== null ? {Code: originalErrorCode} : undefined,
        });
    } else {
        if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn("Unclassified Cloudflare R2 error:", error);
        }
        return new UnknownError(message, {
            // Return a non-Error object for `cause` so we don't include the same error
            // twice in logging.
            cause: originalErrorCode !== null ? {Code: originalErrorCode} : undefined,
        });
    }
}

/**
 * Does this error have a `NoSuchKey` code thrown by a [`GetObject`][1] S3
 * action? Recurses into the cause of an error looking for a `NoSuchKey` code.
 *
 * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
 */
export function isCloudflareR2NoSuchKeyError(error: unknown): boolean {
    if (isObject(error) && error.Code === "NoSuchKey") return true;

    // Recurse into the error's cause if there is one.
    // `classifyCloudflareR2Error()` puts put the original error in the cause
    // property.
    if (error instanceof Error && "cause" in error)
        return isCloudflareR2NoSuchKeyError(error.cause);

    return false;
}

/**
 * Is this an error generated by a conflict for an `If-None-Match: *` header?
 *
 * The [AWS S3 documentation for `PutObject()`][1] says we could get a
 * "412 PreconditionFailed" or a "409 ConditionalRequestConflict" error from
 * the `If-None-Match: *` header. The [Cloudflare R2 documentation for
 * `PutObject()` extensions][2] says we could get a a "412 PreconditionFailed"
 * error from the `If-None-Match: *` header.
 *
 * This function looks for all possible errors codes.
 *
 * [1]: https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html#API_PutObject_RequestSyntax
 * [2]: https://developers.cloudflare.com/r2/api/s3/extensions/#conditional-operations-in-putobject
 */
export function isCloudflareR2ConditionConflictError(error: unknown): boolean {
    if (
        isObject(error) &&
        (error.Code === "PreconditionFailed" || error.Code === "ConditionalRequestConflict")
    ) {
        return true;
    }

    // Recurse into the error's cause if there is one.
    // `classifyCloudflareR2Error()` puts put the original error in the cause
    // property.
    if (error instanceof Error && "cause" in error)
        return isCloudflareR2ConditionConflictError(error.cause);

    return false;
}
