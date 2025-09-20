import {intoApiContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {ApiMessageStreamPartPayload} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";

export async function intoApiMessageStreamPartPayload(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    payload: MessageStreamPartPayload,
): Promise<ApiMessageStreamPartPayload> {
    switch (payload.type) {
        case "ToolCall":
            return payload;
        case "Content": {
            const content = await intoApiContentWithReferences(context, spaceId, payload.content);
            return {type: "Content", content};
        }
        default:
            throw exhaustive(payload);
    }
}
