import {intoApiMessageContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {parseApiMentionTarget} from "~/shared/api/parse_api_path.js";
import {
    ApiMentionTargetResponse,
    ApiMessageStreamPartPayloadResponse,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";

export async function intoApiMessageStreamPartPayload(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    payload: MessageStreamPartPayload,
): Promise<ApiMessageStreamPartPayloadResponse> {
    switch (payload.type) {
        case "ToolCall": {
            switch (payload.call.type) {
                case "Read": {
                    return {
                        type: "ToolCall",
                        call: {
                            type: "Read",
                            // TODO(ifitzsimmons, 2026-01-26): This is what we were doing before, just
                            // within `printApiMentionTargetResponse`. This is not type safe and I'm
                            // not really sure how this working before. For example, tasks require the
                            // task status in the response, but that's not available on the `targetPath`.
                            // I would expect this to break any time we try to return this response via
                            // the API.
                            target: parseApiMentionTarget(
                                payload.call.targetPath,
                            ) as ApiMentionTargetResponse,
                        },
                    };
                }
                case "Search": {
                    return {
                        type: "ToolCall",
                        call: {
                            type: "Search",
                            query: payload.call.query,
                        },
                    };
                }
                default:
                    throw exhaustive(payload.call);
            }
        }
        case "Content": {
            const content = await intoApiMessageContentWithReferences(
                context,
                spaceId,
                payload.content,
            );
            return {type: "Content", content};
        }
        case "Reasoning": {
            const content = await intoApiMessageContentWithReferences(
                context,
                spaceId,
                payload.content,
            );
            return {type: "Reasoning", content};
        }
        default:
            throw exhaustive(payload);
    }
}
