import prettyBytes from "pretty-bytes";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {getSessionCookieIfExists} from "~/server/tokens/session_cookie.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {Context} from "~/shared/context/context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {deserializeFileAttachmentTargetString} from "~/shared/files/file_attachment_target.js";
import {maxFileContentLength} from "~/shared/files/file_constants.js";
import {canonicalizeFileContentTypeIfExists} from "~/shared/files/file_content_type.js";
import {UploadFileResponseSchema} from "~/shared/files/upload_file_protocol.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    finishUploadingAndStartProcessingFile,
    startUploadingFile,
} from "~/shared/rpc/files_rpc_definitions.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

interface R2BucketInterface {
    put(key: string, body: any, options: {httpMetadata: {contentType: string}}): Promise<unknown>;
}

// This file is used both by `EdgeService` and in tests. So we don't want to
// depend on anything `EdgeService` specific here.
export async function uploadFile(
    createContext: (payload: SessionTokenPayload) => Context<{rpc: RpcContextModuleBase}>,
    executionContext: {},
    env: {FilesBucket: R2BucketInterface},
    tokenAgent: TokenAgent,
    request: Request,
    url: URL,
    span: TracerSpan,
    {spaceId}: {spaceId: SpaceId},
): Promise<Response> {
    try {
        if (request.method !== "POST") throw new InvalidArgumentError("Must use `POST` method");

        const originalContentType = request.headers.get("content-type");
        if (originalContentType === null)
            throw new InvalidArgumentError("`Content-Type` header is required");

        const contentType = canonicalizeFileContentTypeIfExists(originalContentType);

        if (contentType === null) {
            throw new InvalidArgumentError(
                quote`Unsupported \`Content-Type\` header ${originalContentType}`,
            );
        }

        const contentLengthString = request.headers.get("content-length");
        if (contentLengthString === null) {
            throw new InvalidArgumentError("`Content-Length` header is required");
        }

        const contentLength = parseInt(contentLengthString, 10);
        if (isNaN(contentLength) || !/^\d+$/.test(contentLengthString)) {
            throw new InvalidArgumentError("`Content-Length` header must be an integer");
        }

        // If `Content-Length` is 0 there's probably a bug somewhere and data isn't reaching
        // `EdgeService`.
        if (contentLength <= 0) {
            throw new InvalidArgumentError(
                `Can’t upload file with \`Content-Length\` of ${prettyBytes(contentLength)}`,
            );
        }

        // If the client sends more bytes than what they declared in `Content-Length`
        // then Cloudflare will truncate the data to `Content-Length` bytes. This
        // behavior from Cloudflare is important to make sure attackers can't upload
        // files bigger than 1 GB.
        if (contentLength > maxFileContentLength) {
            throw new InvalidArgumentError(
                `\`Content-Length\` of ${prettyBytes(
                    contentLength,
                )} is more than our maximum file size of ${prettyBytes(maxFileContentLength)}`,
            );
        }

        const providedFileId = url.searchParams.get("id");
        if (providedFileId !== null && !isId<FileId>(providedFileId)) {
            throw new InvalidArgumentError("Search param `id` must be a valid `FileId`");
        }

        const attachTargetString = url.searchParams.get("target");
        const attachTarget =
            attachTargetString !== null
                ? deserializeFileAttachmentTargetString(attachTargetString)
                : null;

        const sessionCookieToken = await getSessionCookieIfExists(tokenAgent, request);
        if (!sessionCookieToken) throw unauthenticatedSessionError();

        const context = createContext(sessionCookieToken);

        const {fileId} = await startUploadingFile(context, {
            spaceId,
            fileId: providedFileId,
            contentLength,
            contentType,
            attachTarget,
        });

        // Create a span with the same format as the `PutObject` span created by
        // `CloudflareR2Client`.
        await span.withSpan(`Cloudflare R2 PutObject ${filesBucketName}`, span => {
            const key = `${spaceId}/${fileId}`;

            span.addData({
                cloudflare: {
                    r2: {
                        action: "PutObject",
                        bucket: filesBucketName,
                        object: {
                            key,
                            contentType,
                            contentLength,
                        },
                    },
                },
            });

            return env.FilesBucket.put(key, request.body, {
                httpMetadata: {contentType},
            });
        });

        const {signedUrlSearch, file} = await finishUploadingAndStartProcessingFile(context, {
            spaceId,
            fileId,
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
