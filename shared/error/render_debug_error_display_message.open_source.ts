import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export const debugRedactedString = "████████████";

/**
 * Render the error display message with any sensitive text redacted (with [box
 * drawing unicode block characters][1]).
 *
 * [1]: https://graphemica.com/%E2%96%88
 */
export function renderDebugErrorDisplayMessage(displayMessage: ErrorDisplayMessage): string {
    let debugDisplayMessage = "";

    for (const segment of displayMessage) {
        switch (segment.type) {
            case "Text":
                debugDisplayMessage += segment.text;
                break;
            case "SensitiveText":
                debugDisplayMessage += debugRedactedString;
                break;
            case "Link":
                debugDisplayMessage += `[${segment.text}](${segment.url})`;
                break;
            default:
                throw exhaustive(segment);
        }
    }

    return debugDisplayMessage;
}
