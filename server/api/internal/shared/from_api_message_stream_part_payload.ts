import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {printApiMentionReference} from "~/shared/api/specification/parse_api_path.js";
import {ApiMessageStreamPartPayload} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
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
                            targetPath: printApiMentionReference(payload.call.reference),
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
                            target: payload.call.reference,
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
