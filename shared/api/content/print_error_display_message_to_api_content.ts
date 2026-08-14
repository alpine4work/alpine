import {ApiContentInlineElement} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export function printErrorDisplayMessageToApiContent(
    displayMessage: ErrorDisplayMessage,
): Array<ApiContentInlineElement> {
    return displayMessage.map(displayMessageSegment => {
        switch (displayMessageSegment.type) {
            case "Text":
            case "SensitiveText": {
                return {type: "Text", text: displayMessageSegment.text};
            }
            case "Link": {
                return {
                    type: "Text",
                    text: displayMessageSegment.text,
                    marks: [{type: "Link", url: displayMessageSegment.url}],
                };
            }
            default:
                throw exhaustive(displayMessageSegment);
        }
    });
}
