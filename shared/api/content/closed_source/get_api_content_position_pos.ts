import {
    ApiContentDecodedKey,
    ApiContentKeyDecoder,
} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {ApiContentPosition} from "~/shared/api/specification/types/api_content_position.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

export function getApiContentPositionPos(
    decoder: ApiContentKeyDecoder,
    position: ApiContentPosition,
): number {
    const decodedKey = decoder.decode(position.key);
    return getApiContentPositionPosWithDecodedKey(decodedKey, position);
}

export function getApiContentPositionPosWithDecodedKey(
    decodedKey: ApiContentDecodedKey,
    position: ApiContentPosition,
): number {
    switch (position.type) {
        case "Inline": {
            const {pos, nodeSize, inlineContent} = decodedKey;

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
            const {pos} = decodedKey;
            return pos;
        }
        case "After": {
            const {pos, nodeSize} = decodedKey;
            return pos + nodeSize;
        }
        default:
            throw exhaustive(position);
    }
}
