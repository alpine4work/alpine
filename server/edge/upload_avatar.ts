import prettyBytes from "pretty-bytes";
import {WorkerSessionActorContextModule} from "~/server/cloudflare/context/worker_actor_context_module.js";
import {authorizeRequestAndGetSessionToken} from "~/server/edge/internal/authorize_request_and_get_session_token.js";
import {
    PutR2ObjectBucketInterface,
    putR2ObjectWithSpan,
} from "~/server/edge/internal/put_r2_object_with_span.js";
import {validateContentMetadataAndGetCanonicalContentType} from "~/server/edge/internal/validate_content_metadata_and_get_canonical_content_type.js";
import {avatarsBucketName} from "~/server/helpers/avatars_cloudflare_r2_bucket_name.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {avatarContentType, maxAvatarUploadContentLength} from "~/shared/avatar/avatar_constants.js";
import {AvatarEntityPath, parseAvatarEntityPath} from "~/shared/avatar/avatar_entity_path.js";
import {ResizeAvatarForUploadRequestSchema} from "~/shared/avatar/protocol/resize_avatar_for_upload_request_schema.js";
import {ResizeAvatarForUploadResponseSchema} from "~/shared/avatar/protocol/resize_avatar_for_upload_response_schema.js";
import {UploadAvatarRequestSchema} from "~/shared/avatar/protocol/upload_avatar_request_schema.js";
import {UploadAvatarResponseSchema} from "~/shared/avatar/protocol/upload_avatar_response_schema.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, InvalidArgumentError, UnimplementedError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {FileImageContentType, isFileImageContentType} from "~/shared/files/file_content_type.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {AvatarId} from "~/shared/id/types/id_types.js";
import {finishUploadingAccountAvatar} from "~/shared/rpc/accounts_rpc_definitions.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export async function uploadAvatar(
    createContext: (payload: SessionTokenPayload) => Context<{
        rpc: RpcContextModuleBase;
        tracer: TracerContextModule;
        batch: BatchContextModule;
        actor: WorkerSessionActorContextModule;
    }>,
    executionContext: {},
    env: {AvatarsBucket: PutR2ObjectBucketInterface; FILE_PROCESSOR_SERVICE_URL?: string},
    tokenAgent: TokenAgent,
    request: Request,
    url: URL,
    span: TracerSpan,
    avatarEntityPath: AvatarEntityPath,
): Promise<Response> {
    try {
        if (request.method !== "POST") throw new InvalidArgumentError("Must use `POST` method");

        const {type} = parseAvatarEntityPath(avatarEntityPath);
        if (type === "space") {
            throw new UnimplementedError("Spaces are not supported yet");
        }

        const requestBody = UploadAvatarRequestSchema.deserialize(await request.json());

        // TODO(#add-space-avatar-support): validate that the types match
        if (type === "account" && requestBody.type !== "UploadAccountAvatar") {
            throw new InvalidArgumentError("Expected `UploadAccountAvatar` request");
        }

        const fileProcessorServiceUrl = env.FILE_PROCESSOR_SERVICE_URL;
        if (!fileProcessorServiceUrl) {
            throw new InternalError("Missing `FILE_PROCESSOR_SERVICE_URL` env variable");
        }

        const contentLength = requestBody.content.length;
        const contentType = validateContentMetadataAndGetCanonicalContentType({
            originalContentType: requestBody.contentType,
            contentLength,
        });

        const sessionCookieToken = await authorizeRequestAndGetSessionToken(tokenAgent, request);
        const context = createContext(sessionCookieToken);

        if (contentLength > maxAvatarUploadContentLength) {
            throw new InvalidArgumentError(
                `\`Content-Length\` of ${prettyBytes(
                    contentLength,
                )} is more than our maximum file size of ${prettyBytes(
                    maxAvatarUploadContentLength,
                )}`,
            );
        }

        if (!isFileImageContentType(contentType)) {
            throw new InternalError(
                quote`Unsupported \`Content-Type\` ${contentType} for avatar processing`,
            );
        }

        const avatarId = generateChronologicalId<AvatarId>();

        // 1. Upload original avatar to R2
        const originalKey = `${avatarEntityPath}/original/${avatarId}`;
        await putR2ObjectWithSpan(span, {
            key: originalKey,
            body: requestBody.content,
            contentType,
            contentLength,
            bucketName: avatarsBucketName,
            bucket: env.AvatarsBucket,
        });

        const processedAvatarBytes = await callFileProcessorResizeAvatar(context, {
            fileProcessorServiceUrl,
            tokenAgent,
            avatarEntityPath,
            avatarId,
            span,
            contentType,
        });

        // TODO(ifitzsimmons, 2025-08-11): store the original in a websafe format as well
        // so that it can one day be displayed in a larger format for something like a
        // "Profile" page.

        const [response] = await runAllPromises([
            finishUploadingAccountAvatar(context, {
                avatarContent: processedAvatarBytes,
                avatarId,
            }),
            putR2ObjectWithSpan(span, {
                key: `${avatarEntityPath}/${avatarId}`,
                body: processedAvatarBytes,
                contentType: avatarContentType,
                bucketName: avatarsBucketName,
                contentLength: processedAvatarBytes.length,
                bucket: env.AvatarsBucket,
            }),
        ]);

        return new Response(
            JSON.stringify(
                UploadAvatarResponseSchema.serialize({
                    ok: true,
                    account: response.account,
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
                UploadAvatarResponseSchema.serialize({
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

async function callFileProcessorResizeAvatar(
    context: Context<{actor: WorkerSessionActorContextModule}>,
    {
        avatarId,
        fileProcessorServiceUrl,
        avatarEntityPath,
        span,
        tokenAgent,
        contentType,
    }: {
        avatarId: AvatarId;
        contentType: FileImageContentType;
        fileProcessorServiceUrl: string;
        avatarEntityPath: AvatarEntityPath;
        span: TracerSpan;
        tokenAgent: TokenAgent;
    },
): Promise<Uint8Array> {
    const headers = new Headers();
    addTracerPropagationContextHeader(headers, span);
    headers.delete("cookie");
    headers.delete("content-type");

    const token = await tokenAgent.privateSide.dangerouslySignShortLivedToken(
        "FileProcessorService",
        {
            type: "Session",
            sessionId: context.actor.getSessionId(),
            accountId: context.actor.getAccountId(),
        },
    );
    headers.set("authorization", `bearer ${token}`);

    const route = "/avatar";
    const url = new URL(route, fileProcessorServiceUrl);
    const response = await fetchWithTracer(
        span,
        url,
        {
            headers,
            method: "POST",
            serviceName: "FileProcessorService",
            route,
            body: JSON.stringify(
                ResizeAvatarForUploadRequestSchema.serialize({
                    avatarEntityPath,
                    avatarId,
                    contentType,
                }),
            ),
        },
        async response => {
            const responseData = await response.json();
            const responseBody = ResizeAvatarForUploadResponseSchema.deserialize(responseData);
            if (!responseBody.ok) throw responseBody.error;
            return responseBody;
        },
    );

    return response.content;
}
