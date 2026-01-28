import {fromApiContent} from "~/server/api/content/from_api_content.js";
import {printApiMentionTarget} from "~/shared/api/parse_api_path.js";
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
        case "Content": {
            const content = assertMessageContent(
                fromApiContent(MessageContentProsemirrorSchema, payload.content),
            );
            return {type: "Content", content};
        }
        case "ToolCall": {
            switch (payload.call.type) {
                case "Read": {
                    return {
                        type: "ToolCall",
                        call: {
                            type: "Read",
                            targetPath: printApiMentionTarget(payload.call.target),
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
        case "Reasoning": {
            return {
                type: "Reasoning",
                content: assertMessageContent(
                    fromApiContent(MessageContentProsemirrorSchema, payload.content),
                ),
            };
        }
        default:
            throw exhaustive(payload);
    }
}
