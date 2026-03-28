import {ApiContentKeyDecoder} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {ApiContentPosition} from "~/shared/api/specification/types/api_content_position.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export function getApiContentPositionPos(
    decoder: ApiContentKeyDecoder,
    position: ApiContentPosition,
): number {
    switch (position.type) {
        case "Inline": {
            const {pos, nodeSize, inlineContent} = decoder.decode(position.key);

            if (!inlineContent) {
                throw new InvalidArgumentError("Content key isn\u2019t for inline content", {
                    displayMessage: errorDisplayMessage`Content key doesn\u2019t support \`Inline\` positions. Try again with a \`Before\` or \`After\` position.`,
                });
            }

            if (!(0 <= position.index && position.index <= nodeSize)) {
                throw new InvalidArgumentError("Index out of bounds", {
                    displayMessage: errorDisplayMessage`Content position is out of bounds. Try again with an \`Inline\` position \`index\` between 0 and ${nodeSize}.`,
                });
            }

            return pos + 1 + position.index;
        }
        case "Before": {
            const {pos} = decoder.decode(position.key);
            return pos;
        }
        case "After": {
            const {pos, nodeSize} = decoder.decode(position.key);
            return pos + nodeSize;
        }
        default:
            throw exhaustive(position);
    }
}
