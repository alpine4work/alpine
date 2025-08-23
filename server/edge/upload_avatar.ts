import prettyBytes from "pretty-bytes";
import {WorkerSessionActorContextModule} from "~/server/cloudflare/context/worker_actor_context_module.js";
import {authorizeRequestAndGetSessionToken} from "~/server/edge/internal/authorize_request_and_get_session_token.js";
import {getContentLengthAndCanonicalContentType} from "~/server/edge/internal/get_content_length_and_content_type.js";
import {
    PutR2ObjectBucketInterface,
    putR2ObjectWithSpan,
} from "~/server/edge/internal/put_r2_object_with_span.js";
import {avatarsBucketName} from "~/server/helpers/avatars_cloudflare_r2_bucket_name.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {
    avatarContentType,
    defaultAvatarSize,
    defaultProfileImageSize,
    maxAvatarUploadContentLength,
    maxResizedAvatarContentLength,
} from "~/shared/avatar/avatar_constants.js";
import {
    AvatarEntityPath,
    parseAvatarEntityPath,
    printAvatarEntityPathIntoCloudflareR2Key,
} from "~/shared/avatar/avatar_entity_path.js";
import {AvatarTheme, isAvatarTheme} from "~/shared/avatar/avatar_schema.js";
import {ResizeAvatarForUploadRequestSchema} from "~/shared/avatar/protocol/resize_avatar_for_upload_request_schema.js";
import {ResizeAvatarForUploadResponseSchema} from "~/shared/avatar/protocol/resize_avatar_for_upload_response_schema.js";
import {UploadAvatarResponseSchema} from "~/shared/avatar/protocol/upload_avatar_response_schema.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {FileImageContentType, isFileImageContentType} from "~/shared/files/file_content_type.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {AvatarId} from "~/shared/id/types/id_types.js";
import {finishUploadingAccountAvatar} from "~/shared/rpc/accounts_rpc_definitions.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {finishUploadingSpaceAvatar} from "~/shared/rpc/spaces_rpc_definitions.js";
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

        const fileProcessorServiceUrl = env.FILE_PROCESSOR_SERVICE_URL;
        if (!fileProcessorServiceUrl) {
            throw new InternalError("Missing `FILE_PROCESSOR_SERVICE_URL` env variable");
        }

        const {contentType, contentLength} = getContentLengthAndCanonicalContentType(request);

        const providedColorScheme = url.searchParams.get("themeColor");
        const themeColor = getAvatarThemeColor(providedColorScheme);

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
        await putR2ObjectWithSpan(span, {
            key: printAvatarEntityPathIntoCloudflareR2Key(avatarEntityPath, avatarId, "original"),
            body: request.body,
            contentType,
            contentLength,
            bucketName: avatarsBucketName,
            bucket: env.AvatarsBucket,
        });

        const [avatarImageContent, profileImageContent] = await Promise.all([
            callFileProcessorResizeAvatar(context, {
                fileProcessorServiceUrl,
                tokenAgent,
                avatarEntityPath,
                avatarId,
                span,
                contentType,
                size: defaultAvatarSize,
                maxContentLength: maxResizedAvatarContentLength,
            }),
            callFileProcessorResizeAvatar(context, {
                fileProcessorServiceUrl,
                tokenAgent,
                avatarEntityPath,
                avatarId,
                span,
                contentType,
                size: defaultProfileImageSize,
                maxContentLength: maxAvatarUploadContentLength,
            }),
        ]);

        const [response] = await runAllPromises([
            finishUploadingAvatar(context, {
                avatarId,
                avatarEntityPath,
                avatarContent: avatarImageContent,
                themeColor,
            }),
            putR2ObjectWithSpan(span, {
                key: printAvatarEntityPathIntoCloudflareR2Key(avatarEntityPath, avatarId, "small"),
                body: avatarImageContent,
                contentType: avatarContentType,
                bucketName: avatarsBucketName,
                contentLength: avatarImageContent.length,
                bucket: env.AvatarsBucket,
            }),
            putR2ObjectWithSpan(span, {
                key: printAvatarEntityPathIntoCloudflareR2Key(
                    avatarEntityPath,
                    avatarId,
                    "profile",
                ),
                body: profileImageContent,
                contentType: avatarContentType,
                bucketName: avatarsBucketName,
                contentLength: profileImageContent.length,
                bucket: env.AvatarsBucket,
            }),
        ]);

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: {"content-type": "application/json"},
        });
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

async function finishUploadingAvatar(
    context: Context<{rpc: RpcContextModuleBase}>,
    {
        avatarId,
        avatarEntityPath,
        avatarContent,
        themeColor,
    }: {
        avatarId: AvatarId;
        avatarEntityPath: AvatarEntityPath;
        avatarContent: Uint8Array;
        themeColor: AvatarTheme | null;
    },
) {
    const avatarEntityPathObject = parseAvatarEntityPath(avatarEntityPath);
    switch (avatarEntityPathObject.type) {
        case "account":
            const {account} = await finishUploadingAccountAvatar(context, {
                avatarContent,
                avatarId,
            });
            return UploadAvatarResponseSchema.serialize({
                ok: true,
                type: "UploadAccountAvatar",
                account,
            });
        case "space":
            const {space} = await finishUploadingSpaceAvatar(context, {
                avatarContent,
                avatarId,
                spaceId: avatarEntityPathObject.spaceId,
                avatarTheme: themeColor ?? "light",
            });

            return UploadAvatarResponseSchema.serialize({
                ok: true,
                type: "UploadSpaceAvatar",
                space,
            });
        default:
            throw exhaustive(avatarEntityPathObject);
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
        size,
        maxContentLength,
    }: {
        avatarId: AvatarId;
        contentType: FileImageContentType;
        fileProcessorServiceUrl: string;
        avatarEntityPath: AvatarEntityPath;
        span: TracerSpan;
        tokenAgent: TokenAgent;
        size: number;
        maxContentLength: number;
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
                    size,
                    maxContentLength,
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

function getAvatarThemeColor(providedColorScheme: string | null): AvatarTheme | null {
    if (providedColorScheme === null) return null;

    if (!isAvatarTheme(providedColorScheme)) {
        throw new InvalidArgumentError(
            quote`Unsupported \`themeColor\` value ${providedColorScheme}`,
        );
    }

    return providedColorScheme;
}
