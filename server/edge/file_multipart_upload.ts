import prettyBytes from "pretty-bytes";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {getSessionCookieIfExists} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {Context} from "~/shared/context/context.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {
    maxFileContentLength,
    maxFileMultipartUploadPartContentLength,
} from "~/shared/files/file_constants.js";
import {canonicalizeFileContentTypeIfExists} from "~/shared/files/file_content_type.js";
import {
    CompleteFileMultipartUploadRequestSchema,
    CreateFileMultipartUploadRequestSchema,
    CreateFileMultipartUploadResponseSchema,
    PutFileMultipartUploadPartResponseSchema,
    UploadFileResponseSchema,
} from "~/shared/files/upload_file_protocol.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    finishUploadingAndStartProcessingFile,
    getFileWithoutSignedUrlAsUploader,
    startUploadingFile,
} from "~/shared/rpc/files_rpc_definitions.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

interface R2BucketInterface {
    put(
        key: string,
        body: any,
        options: {httpMetadata: {contentType: string}},
    ): Promise<R2ObjectInterface | null>;
    delete(keys: string): Promise<void>;
    createMultipartUpload(
        key: string,
        options: {httpMetadata: {contentType: string}},
    ): Promise<R2MultipartUploadInterface>;
    resumeMultipartUpload(key: string, uploadId: string): R2MultipartUploadInterface;
}

interface R2MultipartUploadInterface {
    readonly uploadId: string;
    uploadPart(partNumber: number, value: any): Promise<R2UploadedPartInterface>;
    complete(uploadedParts: Array<R2UploadedPartInterface>): Promise<R2ObjectInterface>;
}

interface R2UploadedPartInterface {
    partNumber: number;
    etag: string;
}

interface R2ObjectInterface {
    readonly size: number;
    readonly httpMetadata?: {contentType?: string};
}

export async function createFileMultipartUpload(
    createContext: (payload: SessionTokenPayload) => Context<{rpc: RpcContextModuleBase}>,
    executionContext: {},
    env: {FilesBucket: R2BucketInterface; COOKIE_NAME_SUFFIX: string},
    tokenAgent: TokenAgent,
    request: Request,
    url: URL,
    span: TracerSpan,
    {spaceId}: {spaceId: SpaceId},
): Promise<Response> {
    try {
        if (request.method !== "POST") throw new InvalidArgumentError("Must use `POST` method");

        const requestBody = CreateFileMultipartUploadRequestSchema.deserialize(
            await request.json(),
        );

        const contentType = canonicalizeFileContentTypeIfExists(requestBody.contentType);

        if (contentType === null) {
            throw new InvalidArgumentError(
                quote`Unsupported \`Content-Type\` option ${requestBody.contentType}`,
            );
        }

        // If `Content-Length` is 0 there's probably a bug somewhere and data isn't
        // reaching `EdgeService`.
        if (requestBody.contentLength <= 0) {
            throw new InvalidArgumentError(
                `Can\u2019t upload file with \`Content-Length\` of ${prettyBytes(
                    requestBody.contentLength,
                )}`,
            );
        }

        if (requestBody.contentLength > maxFileContentLength) {
            throw new InvalidArgumentError(
                `\`Content-Length\` of ${prettyBytes(
                    requestBody.contentLength,
                )} is more than our maximum file size of ${prettyBytes(maxFileContentLength)}`,
            );
        }

        const sessionCookieToken = await getSessionCookieIfExists({
            tokenAgent,
            cookieNameSuffix: env.COOKIE_NAME_SUFFIX,
            request,
        });
        if (!sessionCookieToken) throw unauthenticatedSessionError();

        const context = createContext(sessionCookieToken);

        const {fileId} = await startUploadingFile(context, {
            spaceId,
            fileId: requestBody.fileId,
            contentType,
            contentLength: requestBody.contentLength,
            attachTarget: requestBody.attachTarget,
        });

        // Create a span with the same format as the `PutObject` span created by
        // `CloudflareR2Client`.
        const multipartUpload = await span.withSpan(
            `Cloudflare R2 CreateMultipartUpload ${filesBucketName}`,
            async span => {
                const key = `${spaceId}/${fileId}`;

                span.addData({
                    cloudflare: {
                        r2: {
                            action: "CreateMultipartUpload",
                            bucket: filesBucketName,
                            object: {
                                key,
                                contentType,
                                contentLength: requestBody.contentLength,
                            },
                        },
                    },
                });

                const multipartUpload = await env.FilesBucket.createMultipartUpload(key, {
                    httpMetadata: {contentType},
                });

                span.addData({
                    cloudflare: {
                        r2: {
                            multipartUpload: {
                                id: multipartUpload.uploadId,
                            },
                        },
                    },
                });

                return multipartUpload;
            },
        );

        return new Response(
            JSON.stringify(
                CreateFileMultipartUploadResponseSchema.serialize({
                    ok: true,
                    fileId,
                    uploadId: multipartUpload.uploadId,
                }),
            ),
            {
                status: 200,
                headers: {"content-type": "application/json"},
            },
        );
    } catch (error) {
        span.addException(error);

        const statusCode = isSystemError(error) ? 500 : 400;

        return new Response(
            JSON.stringify(
                CreateFileMultipartUploadResponseSchema.serialize({
                    ok: false,
                    error,
                }),
            ),
            {
                status: statusCode,
                headers: {"content-type": "application/json"},
            },
        );
    }
}

export async function putFileMultipartUploadPart(
    createContext: (payload: SessionTokenPayload) => Context<{rpc: RpcContextModuleBase}>,
    executionContext: {},
    env: {FilesBucket: R2BucketInterface; COOKIE_NAME_SUFFIX: string},
    tokenAgent: TokenAgent,
    request: Request,
    url: URL,
    span: TracerSpan,
    {
        spaceId,
        fileId,
        partNumber: partNumberString,
    }: {
        spaceId: SpaceId;
        fileId: FileId;
        partNumber: string;
    },
): Promise<Response> {
    try {
        if (request.method !== "PUT") throw new InvalidArgumentError("Must use `PUT` method");

        const uploadId = url.searchParams.get("upload");
        if (uploadId === null) {
            throw new InvalidArgumentError("`upload` search param is required");
        }

        const partNumber = parseInt(partNumberString, 10);
        if (isNaN(partNumber) || !/^\d+$/.test(partNumberString)) {
            throw new InvalidArgumentError("Part number must be an integer");
        }

        if (partNumber <= 0) {
            throw new InvalidArgumentError("Part number must be greater than 0");
        }

        const contentLengthString = request.headers.get("content-length");
        if (contentLengthString === null) {
            throw new InvalidArgumentError("`Content-Length` header is required");
        }

        const contentLength = parseInt(contentLengthString, 10);
        if (isNaN(contentLength) || !/^\d+$/.test(contentLengthString)) {
            throw new InvalidArgumentError("`Content-Length` header must be an integer");
        }

        // If `Content-Length` is 0 there's probably a bug somewhere and data isn't
        // reaching `EdgeService`.
        if (contentLength <= 0) {
            throw new InvalidArgumentError(
                `Can\u2019t upload file with \`Content-Length\` of ${prettyBytes(contentLength)}`,
            );
        }

        // If the client sends more bytes than what they declared in `Content-Length` then
        // Cloudflare will truncate the data to `Content-Length` bytes. This behavior from
        // Cloudflare is important to make sure attackers can't upload files bigger than 1
        // GB.
        if (contentLength > maxFileMultipartUploadPartContentLength) {
            throw new InvalidArgumentError(
                `\`Content-Length\` of ${prettyBytes(
                    contentLength,
                )} is more than our maximum file multipart upload size of ${prettyBytes(
                    maxFileMultipartUploadPartContentLength,
                )}`,
            );
        }

        const sessionCookieToken = await getSessionCookieIfExists({
            tokenAgent,
            cookieNameSuffix: env.COOKIE_NAME_SUFFIX,
            request,
        });
        if (!sessionCookieToken) throw unauthenticatedSessionError();

        const context = createContext(sessionCookieToken);

        const requestBody = request.body;
        if (requestBody === null) throw new InvalidArgumentError("Request body is required");

        // Throws an error if the file doesn't exist or the session actor doesn't have
        // access to the file.
        const {file} = await getFileWithoutSignedUrlAsUploader(context, {spaceId, fileId});
        if (!file.initialData.isUploading)
            throw new FailedPreconditionError("File has finished uploading");

        // Make sure the user isn't allowed to upload more parts than what's necessary to
        // fulfill the `Content-Length` they originally declared when starting the
        // multipart file upload.
        //
        // This is important to make sure attackers can't use Alpine to store more data
        // than what's allowed.
        const maxPartNumber = Math.ceil(
            file.contentLength / maxFileMultipartUploadPartContentLength,
        );
        if (partNumber > maxPartNumber) {
            throw new FailedPreconditionError(
                `Part number must be less than or equal to ${maxPartNumber}`,
            );
        }

        // Create a span with the same format as the `PutObject` span created by
        // `CloudflareR2Client`.
        const uploadedPart = await span.withSpan(
            `Cloudflare R2 UploadPart ${filesBucketName}`,
            async span => {
                const key = `${spaceId}/${fileId}`;

                const multipartUpload = env.FilesBucket.resumeMultipartUpload(key, uploadId);

                span.addData({
                    cloudflare: {
                        r2: {
                            action: "UploadPart",
                            bucket: filesBucketName,
                            multipartUpload: {
                                id: uploadId,
                                partNumber,
                                partContentLength: contentLength,
                            },
                            object: {
                                key,
                                contentType: file.contentType,
                                contentLength: file.contentLength,
                            },
                        },
                    },
                });

                return await multipartUpload.uploadPart(partNumber, requestBody);
            },
        );

        return new Response(
            JSON.stringify(
                PutFileMultipartUploadPartResponseSchema.serialize({
                    ok: true,
                    partNumber: uploadedPart.partNumber,
                    etag: uploadedPart.etag,
                }),
            ),
            {
                status: 200,
                headers: {"content-type": "application/json"},
            },
        );
    } catch (error) {
        span.addException(error);

        // If the request had a body and it hasn't been used yet, consume the body before
        // returning our error so the request client doesn't get `EPIPE` errors.
        if (!request.bodyUsed && request.body) await request.body.pipeTo(new WritableStream());

        const statusCode = isSystemError(error) ? 500 : 400;

        return new Response(
            JSON.stringify(
                PutFileMultipartUploadPartResponseSchema.serialize({
                    ok: false,
                    error,
                }),
            ),
            {
                status: statusCode,
                headers: {"content-type": "application/json"},
            },
        );
    }
}

export async function completeFileMultipartUpload(
    createContext: (payload: SessionTokenPayload) => Context<{rpc: RpcContextModuleBase}>,
    executionContext: {},
    env: {FilesBucket: R2BucketInterface; COOKIE_NAME_SUFFIX: string},
    tokenAgent: TokenAgent,
    request: Request,
    url: URL,
    span: TracerSpan,
    {
        spaceId,
        fileId,
    }: {
        spaceId: SpaceId;
        fileId: FileId;
    },
) {
    try {
        if (request.method !== "POST") throw new InvalidArgumentError("Must use `POST` method");

        const uploadId = url.searchParams.get("upload");
        if (uploadId === null) {
            throw new InvalidArgumentError("`upload` search param is required");
        }

        const sessionCookieToken = await getSessionCookieIfExists({
            tokenAgent,
            cookieNameSuffix: env.COOKIE_NAME_SUFFIX,
            request,
        });
        if (!sessionCookieToken) throw unauthenticatedSessionError();

        const context = createContext(sessionCookieToken);

        const requestBody = CompleteFileMultipartUploadRequestSchema.deserialize(
            await request.json(),
        );

        // Throws an error if the file doesn't exist or the session actor doesn't have
        // access to the file.
        const {file: uploadingFile} = await getFileWithoutSignedUrlAsUploader(context, {
            spaceId,
            fileId,
        });
        if (!uploadingFile.initialData.isUploading)
            throw new FailedPreconditionError("File has finished uploading");

        // Create a span with the same format as the `PutObject` span created by
        // `CloudflareR2Client`.
        const object = await span.withSpan(
            `Cloudflare R2 CompleteMultipartUpload ${filesBucketName}`,
            async span => {
                const key = `${spaceId}/${fileId}`;

                const multipartUpload = env.FilesBucket.resumeMultipartUpload(key, uploadId);

                span.addData({
                    cloudflare: {
                        r2: {
                            action: "CompleteMultipartUpload",
                            bucket: filesBucketName,
                            multipartUpload: {
                                id: uploadId,
                                totalPartCount: requestBody.parts.length,
                            },
                            object: {
                                key,
                            },
                        },
                    },
                });

                const object = await multipartUpload.complete(
                    requestBody.parts as Array<R2UploadedPartInterface>,
                );

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

                return object;
            },
        );

        try {
            const {signedUrlSearch, file} = await finishUploadingAndStartProcessingFile(context, {
                spaceId,
                fileId,
                // Validate that the uploaded file size matches what was declared. We make sure the
                // user has enough storage in their space to upload the file in
                // `startUploadingFile()` at the start of the multipart upload. If an attacker ends
                // up uploading a larger file then they can get around our storage limits!
                validateContentLength: object.size,
            });

            return new Response(
                JSON.stringify(
                    UploadFileResponseSchema.serialize({
                        ok: true,
                        signedUrlSearch,
                        file,
                    }),
                ),
                {
                    status: 200,
                    headers: {"content-type": "application/json"},
                },
            );
        } catch (error) {
            // If we failed to mark our file item as uploaded (most likely because
            // `validateContentLength` failed) delete the file from Cloudflare R2.
            //
            // Create a span with the same format as the `DeleteObject` span created by
            // `CloudflareR2Client`.
            await span.withSpan(`Cloudflare R2 DeleteObject ${filesBucketName}`, span => {
                const key = `${spaceId}/${fileId}`;

                span.addData({
                    cloudflare: {
                        r2: {
                            action: "DeleteObject",
                            bucket: filesBucketName,
                            object: {key},
                        },
                    },
                });

                return env.FilesBucket.delete(key);
            });

            throw error;
        }
    } catch (error) {
        span.addException(error);

        return new Response(
            JSON.stringify(
                UploadFileResponseSchema.serialize({
                    ok: false,
                    error,
                }),
            ),
            {
                status: isSystemError(error) ? 500 : 400,
                headers: {"content-type": "application/json"},
            },
        );
    }
}
