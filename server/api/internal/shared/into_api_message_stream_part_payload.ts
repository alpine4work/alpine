import {intoApiMessageContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {ApiContentKeyEncoder} from "~/shared/api/content/api_content_key.js";
import {parseApiMentionTarget} from "~/shared/api/specification/parse_api_path.js";
import {
    ApiMentionTargetResponse,
    ApiMessageStreamPartPayloadResponse,
    ApiMessageStreamToolCallPartCreateCallTargetResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";

export async function intoApiMessageStreamPartPayload(
    context: ServerAccountActionContext,
    {
        spaceId,
        payload,
        contentKeyEncoder,
        posOffset,
    }: {
        spaceId: SpaceId;
        payload: MessageStreamPartPayload;
        contentKeyEncoder: ApiContentKeyEncoder;
        posOffset?: number;
    },
): Promise<ApiMessageStreamPartPayloadResponse> {
    switch (payload.type) {
        case "ToolCall": {
            switch (payload.call.type) {
                case "Read": {
                    return {
                        type: "ToolCall",
                        call: {
                            type: "Read",
                            // TODO(ifitzsimmons, 2026-01-26): This is what we were doing before, just within
                            // `printApiMentionTargetResponse`. This is not type safe and I'm not really sure
                            // how this working before. For example, tasks require the task status in the
                            // response, but that's not available on the `targetPath`. I would expect this to
                            // break any time we try to return this response via the API.
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
                case "Create": {
                    return {
                        type: "ToolCall",
                        call: {
                            type: "Create",
                            // TODO(ifitzsimmons, 2026-01-26): This is not type safe. For example, tasks
                            // require the task status in the response, but that's not available on the target
                            // I would expect this to break any time we try to return this response via the
                            // API.
                            target: payload.call
                                .target as ApiMessageStreamToolCallPartCreateCallTargetResponse,
                        },
                    };
                }
                default:
                    throw exhaustive(payload.call);
            }
        }
        case "Content": {
            const content = await intoApiMessageContentWithReferences(context, {
                spaceId,
                node: payload.content,
                encoder: contentKeyEncoder,
                posOffset,
            });
            return {type: "Content", content};
        }
        case "Reasoning": {
            const content = await intoApiMessageContentWithReferences(context, {
                spaceId,
                node: payload.content,
                encoder: contentKeyEncoder,
                posOffset,
            });
            return {type: "Reasoning", content};
        }
        default:
            throw exhaustive(payload);
    }
}
