import type {Node} from "prosemirror-model";
import {ApiContentPosition} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {splitGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";

export function getApiContentPositionPos(
    keyData: {pos: number; nodeSize: number},
    position: ApiContentPosition,
    node: Node | null | undefined,
    edge: "Start" | "End",
): number {
    validateApiContentKeyNode(keyData, node);

    switch (position.type) {
        case "Inline": {
            if (node.isLeaf) throw createIndexOutOfBoundsError(0);

            return keyData.pos + 1 + getInclusiveInlinePositionOffset(node, position.index, edge);
        }
        case "Before": {
            return keyData.pos;
        }
        case "After": {
            return keyData.pos + keyData.nodeSize;
        }
        default:
            throw exhaustive(position);
    }
}

function getInclusiveInlinePositionOffset(
    node: Node,
    index: number,
    edge: "Start" | "End",
): number {
    const maxInlineIndex = Math.max(0, getInlineContentIndexLength(node) - 1);
    if (!Number.isSafeInteger(index) || index < 0) {
        throw createIndexOutOfBoundsError(maxInlineIndex);
    }

    let currentIndex = 0;
    let currentOffset = 0;
    for (let childIndex = 0; childIndex < node.childCount; childIndex++) {
        const child = node.child(childIndex);
        if (!child.isText) {
            if (index === currentIndex) {
                return edge === "Start" ? currentOffset : currentOffset + child.nodeSize;
            }

            currentIndex++;
            currentOffset += child.nodeSize;
            continue;
        }

        const text = assertExists(child.text);
        let graphemeOffset = 0;

        for (const grapheme of splitGraphemes(text)) {
            const graphemeIndexLength = Array.from(grapheme).length;
            const graphemeEndOffset = graphemeOffset + grapheme.length;
            if (index < currentIndex + graphemeIndexLength) {
                return currentOffset + (edge === "Start" ? graphemeOffset : graphemeEndOffset);
            }

            currentIndex += graphemeIndexLength;
            graphemeOffset = graphemeEndOffset;
        }

        currentOffset += child.nodeSize;
    }

    throw createIndexOutOfBoundsError(maxInlineIndex);
}

function getInlineContentIndexLength(node: Node): number {
    let length = 0;

    node.forEach(child => {
        length += child.isText ? Array.from(assertExists(child.text)).length : 1;
    });

    return length;
}

function validateApiContentKeyNode(
    keyData: {nodeSize: number},
    node: Node | null | undefined,
): asserts node is Node {
    if (!node || node.nodeSize !== keyData.nodeSize) {
        throw new InvalidArgumentError("Invalid content key", {
            displayMessage: errorDisplayMessage`Invalid content key. Try again with a string from \`element.key\`.`,
        });
    }
}

function createIndexOutOfBoundsError(maxInlineIndex: number): InvalidArgumentError {
    return new InvalidArgumentError("Index out of bounds", {
        displayMessage: errorDisplayMessage`Content position is out of bounds. Try again with an \`Inline\` position \`index\` between 0 and ${maxInlineIndex}.`,
    });
}
