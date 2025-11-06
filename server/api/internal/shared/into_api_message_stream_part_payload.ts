import {intoApiMessageContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {printApiMentionTargetResponse} from "~/shared/api/parse_api_path.js";
import {ApiMessageStreamPartPayloadResponse} from "~/shared/api/types/api_specification_convenience_types.js";
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
                            target: printApiMentionTargetResponse(payload.call.targetPath),
                            title: payload.call.title,
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
        default:
            throw exhaustive(payload);
    }
}
