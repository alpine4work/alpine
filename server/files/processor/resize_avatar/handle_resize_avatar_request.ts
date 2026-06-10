import {resizeAvatar} from "~/server/files/processor/resize_avatar/resize_avatar.js";
import {LambdaActionContext} from "~/server/lambda/helpers/lambda_action_context.js";
import {createDynamoActorSessionContextModule} from "~/server/spaces/create_actor_context_module_from_authorization_header.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {ResizeAvatarForUploadRequestSchema} from "~/shared/avatar/protocol/resize_avatar_for_upload_request_schema.js";
import {InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export async function handleResizeAvatarRequest(
    contextWithoutActor: LambdaActionContext,
    {
        request,
        span,
        tokenAgent,
    }: {
        request: Request;
        url: URL;
        span: TracerSpan;
        tokenAgent: TokenAgent;
    },
): Promise<Response> {
    if (request.method !== "POST") throw new InvalidArgumentError("Invalid HTTP request method");

    const {avatarEntityPath, avatarId, size, maxContentLength} =
        ResizeAvatarForUploadRequestSchema.deserialize(await request.json());

    const context = contextWithoutActor.clone({
        actor: await createDynamoActorSessionContextModule(
            contextWithoutActor,
            request.headers,
            tokenAgent,
        ),
    });

    // Make sure we've been proxied through `EdgeService` when uploading a file. We
    // don't support resizing from other services like `JobQueueService`.
    if (context.actor.serviceName !== "EdgeService")
        throw new PermissionDeniedError("Only `EdgeService` can resize a file");

    // Parse avatar size (default to 72x72)
    if (size <= 0 || size > 512)
        throw new InvalidArgumentError(
            "`size` URL search param must be a positive integer between 1 and 512",
        );

    // Parse target file size (default to 3kb for avatars)
    if (maxContentLength <= 0)
        throw new InvalidArgumentError(
            "`maxContentLength` URL search param must be a positive integer",
        );

    span.addData({
        file: {
            avatar: {
                resize: {
                    request: {
                        height: size,
                        width: size,
                        maxContentLength,
                    },
                },
            },
        },
    });

    return await resizeAvatar(context, span, {
        requestSignal: request.signal,
        avatarEntityPath,
        avatarId,
        size,
        maxContentLength,
    });
}
