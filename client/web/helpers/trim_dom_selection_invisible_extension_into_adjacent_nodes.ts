/**
 * When selecting text in Chrome, sometimes the selection appears to only select a
 * single element but in fact the end position extends into the next node. Chrome
 * doesn't render this invisible extension but it's there.
 *
 * This can lead to confusing behaviors for users who assume their selection is
 * only within one node when in fact it's in two.
 *
 * This function trims the selection by detecting selections which invisibly extend
 * into adjacent nodes and adjusting the selection edges:
 *
 * - If the END is at offset 0 of a text node, move it backward to the previous
 *   text node
 *
 * See `trim_selection_invisible_extension_into_adjacent_nodes.ts` for more
 * detailed documentation on this Chrome behavior.
 */
export function trimDomSelectionInvisibleExtensionIntoAdjacentNodes(selection: {
    startNode: Node;
    startOffset: number;
    endNode: Node;
    endOffset: number;
}): {
    startNode: Node;
    startOffset: number;
    endNode: Node;
    endOffset: number;
} {
    let {endNode, endOffset} = selection;

    // If the selection END is at the start of a text node (offset 0), move it backward
    // to the end of the previous text node. This trims the invisible extension where
    // the end appears to be at the start of one node but the user only selected up to
    // the end of the previous node.
    if (endOffset === 0) {
        const previousTextNode = findPreviousTextNode(endNode);
        if (previousTextNode) {
            endNode = previousTextNode;
            endOffset = previousTextNode.length;
        }
    }

    return {startNode: selection.startNode, startOffset: selection.startOffset, endNode, endOffset};
}

/**
 * Find the previous text node in document order before the given node.
 */
function findPreviousTextNode(node: Node): Text | null {
    let current: Node | null = node;

    // First try to find a text node in siblings
    while (current) {
        if (current.previousSibling) {
            current = current.previousSibling;
            const textNode = findLastTextNode(current);
            if (textNode) return textNode;
        } else {
            // Move up to parent and continue
            current = current.parentNode;
        }
    }

    return null;
}

/**
 * Find the last text node within a node (depth-first, reversed).
 */
function findLastTextNode(node: Node): Text | null {
    if (node instanceof Text) {
        const parentComputedStyle = node.parentElement
            ? getComputedStyle(node.parentElement)
            : null;

        // Ignore text nodes with `user-select: none`. For copy/paste purposes we only want
        // to copy selectable text.
        if ((parentComputedStyle?.userSelect || parentComputedStyle?.webkitUserSelect) !== "none") {
            return node;
        }
    }

    for (let i = node.childNodes.length - 1; i >= 0; i--) {
        const result = findLastTextNode(node.childNodes[i]!);
        if (result) return result;
    }

    return null;
}
