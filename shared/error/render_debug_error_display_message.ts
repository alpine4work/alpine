import {ErrorDisplayMessage} from "~/shared/error/error_display_message";
import {exhaustive} from "~/shared/helpers/control/exhaustive";

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
                debugDisplayMessage += "████████████";
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
