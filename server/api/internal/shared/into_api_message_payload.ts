import {intoApiContent} from "~/server/api/internal/shared/into_api_content.js";
import {ApiMessagePayload} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {MessagePayload} from "~/shared/messaging/message_model.js";

export function intoApiMessagePayload(payload: MessagePayload): ApiMessagePayload {
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
                content: intoApiContent(payload.content),
            };
        default:
            throw exhaustive(payload);
    }
}
