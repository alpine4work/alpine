import os from "os";
import {resizeFile} from "~/server/files/processor/resize_file.js";
import {LambdaActionContext} from "~/server/lambda/helpers/lambda_action_context.js";
import {createActorContextModuleFromAuthorizationHeader} from "~/server/spaces/create_actor_context_module_from_authorization_header.js";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {NotFoundError} from "~/shared/error/error.js";
import {isId} from "~/shared/id/id.js";
import {FileId, SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

// Used for tracing. Keeps span naming consistent with existing ECS service.
const temporaryDirectoryPath = os.tmpdir();

export async function handleResizeFileRequest(
    processContext: LambdaActionContext,
    {
        request,
        url,
        span,
        tokenAgent,
    }: {
        request: Request;
        url: URL;
        span: TracerSpan;
        tokenAgent: TokenAgent;
    },
): Promise<Response> {
    const {spaceId, fileId} = parseRoute(url);

    const actorContextModule = await createActorContextModuleFromAuthorizationHeader(
        processContext,
        request.headers,
        tokenAgent,
        spaceId,
    );

    // Add identification information for the actor to all child spans.
    span.addPropagatedData(actorContextModule.getPropagatedData());

    // Mock withFiber function (not needed in Lambda) until we can decommission the
    // existing ECS service
    const withFiber = async <Value>(
        _context: any,
        action: () => Promise<Value>,
    ): Promise<Value> => {
        return await action();
    };

    return await processContext.with({actor: actorContextModule}, context => {
        return resizeFile(context, span, {
            url,
            request,
            spaceId,
            fileId,
            temporaryDirectoryPath,
            withFiber,
        });
    });
}

function parseRoute(url: URL): {fileId: FileId; spaceId: SpaceId} {
    const pathnameParts = url.pathname.slice(1).split("/");

    if (
        pathnameParts.length === 3 &&
        isId<SpaceId>(pathnameParts[0]!) &&
        pathnameParts[1] === "resize" &&
        isId<FileId>(pathnameParts[2]!)
    ) {
        return {spaceId: pathnameParts[0], fileId: pathnameParts[2]};
    } else {
        throw new NotFoundError("Unrecognized route");
    }
}
