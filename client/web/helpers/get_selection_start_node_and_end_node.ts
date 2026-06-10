import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Determines the direction of a browser [`Selection`][1] and returns the node
 * where the selection starts and the node where the direction ends.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/Selection
 */
export function getSelectionStartNodeAndEndNode(selection: {
    anchorNode: Node;
    anchorOffset: number;
    focusNode: Node;
    focusOffset: number;
}) {
    const anchorParentNodes: Array<Node> = [];
    const focusParentNodes: Array<Node> = [];

    {
        let anchorParentNode: Node | null = selection.anchorNode;
        while (anchorParentNode) {
            anchorParentNodes.push(anchorParentNode);
            anchorParentNode = anchorParentNode.parentNode;
        }
    }

    {
        let focusParentNode: Node | null = selection.focusNode;
        while (focusParentNode) {
            focusParentNodes.push(focusParentNode);
            focusParentNode = focusParentNode.parentNode;
        }
    }

    let commonParentReverseIndex = 1;
    const minParentNodesLength = Math.min(anchorParentNodes.length, focusParentNodes.length);

    for (let reverseIndex = 1; reverseIndex <= minParentNodesLength; reverseIndex++) {
        if (
            anchorParentNodes[anchorParentNodes.length - reverseIndex] !==
            focusParentNodes[focusParentNodes.length - reverseIndex]
        ) {
            break;
        }

        commonParentReverseIndex = reverseIndex;
    }

    const commonParentNode =
        commonParentReverseIndex <= minParentNodesLength
            ? anchorParentNodes[anchorParentNodes.length - commonParentReverseIndex]!
            : null;

    // The selection must start and end in the same document which means there should
    // be a common parent node.
    assert(commonParentNode);

    let start: "Anchor" | "Focus" | undefined;

    // If `commonParentNode` is the focus node AND the anchor node then the value of
    // `start` depends on the text offset.
    if (commonParentNode === selection.focusNode && commonParentNode === selection.anchorNode) {
        start = selection.anchorOffset <= selection.focusOffset ? "Anchor" : "Focus";
    }
    // If `commonParentNode` is the focus node OR the anchor node then the value of
    // `start` is ambiguous. We can pick either direction. We don't believe the browser
    // will every create a selection like this because of its ambiguity.
    else if (
        commonParentNode === selection.focusNode ||
        commonParentNode === selection.anchorNode
    ) {
        start = "Anchor";
    }
    // `commonParentNode` has a child node for both the focus node and the anchor node.
    else {
        const anchorCommonParentChildNode =
            anchorParentNodes[anchorParentNodes.length - (commonParentReverseIndex + 1)]!;

        const focusCommonParentChildNode =
            focusParentNodes[focusParentNodes.length - (commonParentReverseIndex + 1)]!;

        for (const commonParentChildNode of commonParentNode.childNodes) {
            if (commonParentChildNode === anchorCommonParentChildNode) {
                start = "Anchor";
                break;
            }

            if (commonParentChildNode === focusCommonParentChildNode) {
                start = "Focus";
                break;
            }
        }

        // Must have found one of the children in `commonParentNode`.
        assert(start !== undefined);
    }

    const startNode = start === "Anchor" ? selection.anchorNode : selection.focusNode;
    const startOffset = start === "Anchor" ? selection.anchorOffset : selection.focusOffset;
    const startParentNodes = start === "Anchor" ? anchorParentNodes : focusParentNodes;
    const endNode = start === "Anchor" ? selection.focusNode : selection.anchorNode;
    const endOffset = start === "Anchor" ? selection.focusOffset : selection.anchorOffset;
    const endParentNodes = start === "Anchor" ? focusParentNodes : anchorParentNodes;

    return {
        start,
        startNode,
        startOffset,
        startParentNodes,
        endNode,
        endOffset,
        endParentNodes,
        commonParentNode,
        commonParentReverseIndex,
    };
}
