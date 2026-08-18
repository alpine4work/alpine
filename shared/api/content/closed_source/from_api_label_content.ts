import {fromApiContent} from "~/shared/api/content/closed_source/from_api_content.js";
import {ApiLabelContent} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {
    MessageContent,
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";

/**
 * Converts compact API label content into internal single-paragraph message
 * content.
 */
export function fromApiLabelContent(content: ApiLabelContent): MessageContent {
    return assertMessageContent(
        fromApiContent(MessageContentProsemirrorSchema, {
            elements: [{type: "Paragraph", elements: content.elements}],
        }),
    );
}
