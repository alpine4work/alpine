import {fromApiContent} from "~/server/api/internal/shared/from_api_content.js";
import {ApiMessageStreamPartPayload} from "~/shared/api/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";

export function fromApiMessageStreamPartPayload(
    payload: ApiMessageStreamPartPayload,
): MessageStreamPartPayload {
    switch (payload.type) {
        case "ToolCall":
            return payload;
        case "Content": {
            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, payload.content),
            );
            return {type: "Content", content};
        }
        default:
            throw exhaustive(payload);
    }
}
