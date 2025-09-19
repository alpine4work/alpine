import {intoApiContentWithReferences} from "~/server/api/internal/shared/into_api_content_with_references.js";
import {ApiMessagePayload} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {MessagePayload} from "~/shared/messaging/message_model.js";

export async function intoApiMessagePayloadWithReferences(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    payload: MessagePayload,
): Promise<ApiMessagePayload> {
    switch (payload.type) {
        case "Deleted": {
            return {type: "Deleted"};
        }
        case "Content":
            return {
                type: "Content",
                parent:
                    payload.parentMessageIndex !== null
                        ? {type: "Message", index: payload.parentMessageIndex}
                        : undefined,
                content: await intoApiContentWithReferences(context, spaceId, payload.content),
            };
        default:
            throw exhaustive(payload);
    }
}
