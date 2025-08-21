import prettyBytes from "pretty-bytes";
import {authorizeRequestAndGetSessionToken} from "~/server/edge/internal/authorize_request_and_get_session_token.js";
import {getContentLengthAndCanonicalContentType} from "~/server/edge/internal/get_content_length_and_content_type.js";
import {
    PutR2ObjectBucketInterface,
    putR2ObjectWithSpan,
} from "~/server/edge/internal/put_r2_object_with_span.js";
import {filesBucketName} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {Context} from "~/shared/context/context.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {deserializeFileAttachmentTargetString} from "~/shared/files/file_attachment_target.js";
import {maxFileContentLength} from "~/shared/files/file_constants.js";
import {UploadFileResponseSchema} from "~/shared/files/upload_file_protocol.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    finishUploadingAndStartProcessingFile,
    startUploadingFile,
} from "~/shared/rpc/files_rpc_definitions.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// This file is used both by `EdgeService` and in tests. So we don't want to
// depend on anything `EdgeService` specific here.
export async function uploadFile(
    createContext: (payload: SessionTokenPayload) => Context<{rpc: RpcContextModuleBase}>,
    executionContext: {},
    env: {FilesBucket: PutR2ObjectBucketInterface},
    tokenAgent: TokenAgent,
    request: Request,
    url: URL,
    span: TracerSpan,
    {spaceId}: {spaceId: SpaceId},
): Promise<Response> {
    try {
        if (request.method !== "POST") throw new InvalidArgumentError("Must use `POST` method");

        const {contentType, contentLength} = getContentLengthAndCanonicalContentType(request);

        const sessionCookieToken = await authorizeRequestAndGetSessionToken(tokenAgent, request);
        const context = createContext(sessionCookieToken);

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

        const {fileId} = await startUploadingFile(context, {
            spaceId,
            fileId: providedFileId,
            contentLength,
            contentType,
            attachTarget,
        });

        await putR2ObjectWithSpan(span, {
            bucket: env.FilesBucket,
            bucketName: filesBucketName,
            key: `${spaceId}/${fileId}`,
            body: request.body,
            contentType,
            contentLength,
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
