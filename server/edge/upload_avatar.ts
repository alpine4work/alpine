import prettyBytes from "pretty-bytes";
import {authorizeRequestAndGetSessionToken} from "~/server/edge/internal/authorize_request_and_get_session_token.js";
import {getContentLengthAndCanonicalContentType} from "~/server/edge/internal/get_content_length_and_content_type.js";
import {
    PutR2ObjectBucketInterface,
    putR2ObjectWithSpan,
} from "~/server/edge/internal/put_r2_object_with_span.js";
import {SessionActorContextModule} from "~/server/helpers/actor_context_module.js";
import {avatarsBucketName} from "~/server/helpers/avatars_cloudflare_r2_bucket_name.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {SessionTokenPayload} from "~/server/tokens/token_payload.js";
import {
    defaultAvatarSize,
    defaultProfileImageSize,
    maxAvatarUploadContentLength,
    maxResizedAvatarContentLength,
} from "~/shared/avatar/avatar_constants.js";
import {
    AvatarEntityPath,
    AvatarEntityPathObject,
    parseAvatarEntityPath,
    printAvatarEntityPathIntoCloudflareR2Key,
} from "~/shared/avatar/avatar_entity_path.js";
import {AvatarTheme, isAvatarTheme} from "~/shared/avatar/avatar_schema.js";
import {getAvatarContentType} from "~/shared/avatar/get_avatar_content_type.js";
import {ResizeAvatarForUploadRequestSchema} from "~/shared/avatar/protocol/resize_avatar_for_upload_request_schema.js";
import {ResizeAvatarForUploadResponseSchema} from "~/shared/avatar/protocol/resize_avatar_for_upload_response_schema.js";
import {UploadAvatarResponseSchema} from "~/shared/avatar/protocol/upload_avatar_response_schema.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    InternalError,
    InvalidArgumentError,
    PermissionDeniedError,
} from "~/shared/error/error.open_source.js";
import {isSystemError} from "~/shared/error/is_system_error_code.open_source.js";
import {
    FileImageContentType,
    isFileImageContentType,
} from "~/shared/files/file_content_type.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {AvatarId} from "~/shared/id/types/id_types.open_source.js";
import {finishUploadingAccountAvatar} from "~/shared/rpc/accounts_rpc_definitions.js";
import {finishUploadingBotAvatar} from "~/shared/rpc/bots_rpc_definitions.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {finishUploadingSpaceAvatar} from "~/shared/rpc/spaces_rpc_definitions.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.open_source.js";
import {addTracerPropagationContextHeader} from "~/shared/tracer/tracer_propagation_context_header.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export async function uploadAvatar(
    createContext: (payload: SessionTokenPayload) => Context<{
        rpc: RpcContextModuleBase;
        tracer: TracerContextModule;
        batch: BatchContextModule;
        actor: SessionActorContextModule;
    }>,
    executionContext: {},
    env: {
        AvatarsBucket: PutR2ObjectBucketInterface;
        COOKIE_NAME_SUFFIX: string;
        FILE_PROCESSOR_SERVICE_URL?: string;
    },
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

        const sessionCookieToken = await authorizeRequestAndGetSessionToken({
            tokenAgent,
            cookieNameSuffix: env.COOKIE_NAME_SUFFIX,
            request,
        });
        const context = createContext(sessionCookieToken);

        const avatarEntityPathObject = parseAvatarEntityPath(avatarEntityPath);

        if (
            avatarEntityPathObject.type === "account" &&
            avatarEntityPathObject.accountId !== sessionCookieToken.accountId
        ) {
            throw new PermissionDeniedError(
                "Can\u2019t upload account avatar for account that\u2019s not the session\u2019s account",
            );
        }

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
                avatarEntityPathObject,
                avatarContent: avatarImageContent,
                themeColor,
            }),
            putR2ObjectWithSpan(span, {
                key: printAvatarEntityPathIntoCloudflareR2Key(avatarEntityPath, avatarId, "small"),
                body: avatarImageContent,
                // Should always be `image/avif`. Our file avatar resize endpoint should always
                // output AVIF.
                contentType: getAvatarContentType(avatarImageContent),
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
                // Should always be `image/avif`. Our file avatar resize endpoint should always
                // output AVIF.
                contentType: getAvatarContentType(profileImageContent),
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
        avatarEntityPathObject,
        avatarContent,
        themeColor,
    }: {
        avatarId: AvatarId;
        avatarEntityPathObject: AvatarEntityPathObject;
        avatarContent: Uint8Array;
        themeColor: AvatarTheme | null;
    },
) {
    switch (avatarEntityPathObject.type) {
        case "account": {
            const {account} = await finishUploadingAccountAvatar(context, {
                avatarContent,
                accountId: avatarEntityPathObject.accountId,
                avatarId,
            });

            return UploadAvatarResponseSchema.serialize({
                ok: true,
                type: "UploadAccountAvatar",
                account,
            });
        }
        case "bot": {
            // NOTE(ifitzsimmons, #bots): When updating the avatar for a bot, it will take some
            // time before the avatar is fanned out to all of the bot accounts (the spaces in
            // which the bot lives). So there are a couple of important things to note for the
            // future:
            //
            // 1. If we _do_ build a bot management page (which I figure we will eventually), I
            //    imagine we'll need a `BotRegistry` so that we can call the equivalent of
            //    `accountRegistry.immediatelyUpdateAccountStoreIfExists(response.account)`
            //    after the bot's avatar is finished uploading. This will update the bot's
            //    avatar in a "Bot Settings" page immediately.
            // 2. However, outside of the settings page, the Bot Avatar should and will be
            //    served by the `Account#Avatar` item for a bot in a given space. This means
            //    that a user will see the bot's avatar updated in the settings page, but there
            //    may be a delay until they see the new avatar reflected in all other surfaces.
            //    We can handle this one of two ways: a. On the client, check the BotRegistry
            //    for every bot account and merge the avatar from the registry into the account
            //    store's account data if they do not match. b. Educate users that it may take
            //    some time for the avatar updates to be reflected in the app after updating.
            //
            // These are both future considerations, but do impact the design of bot avatar
            // (and bot name) updates.
            const {bot} = await finishUploadingBotAvatar(context, {
                avatarContent,
                avatarId,
                botId: avatarEntityPathObject.botId,
            });
            return UploadAvatarResponseSchema.serialize({
                ok: true,
                type: "UploadBotAvatar",
                bot,
            });
        }
        case "space": {
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
        }
        default:
            throw exhaustive(avatarEntityPathObject);
    }
}

async function callFileProcessorResizeAvatar(
    context: Context<{actor: SessionActorContextModule}>,
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
