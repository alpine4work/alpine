type DomNode = globalThis.Node;

/**
 * Get the position in a ProseMirror node from a DOM position. The DOM position
 * typically comes from the selection API. Uses the `data-pos` attributes
 * `serialize_prosemirror_node_to_html.ts` adds to the DOM to figure out our DOM
 * position.
 */
export function getContentViewPosFromDom(
    parentElement: Element,
    node: DomNode,
    offset: number,
    options?: {posAttributeOffset?: number},
): [number, number] | null {
    if (!parentElement.contains(node)) return null;

    // If our selection is not in a text node (e.g. it's in an image element) then find
    // the nearest parent with a `data-pos` attribute. That's our position.
    if (!(node instanceof Text)) {
        let currentNode: DomNode | null = node;
        while (currentNode && currentNode !== parentElement) {
            const posString =
                currentNode instanceof Element ? currentNode.getAttribute("data-pos") : null;

            if (posString !== null) {
                // Double check that we're still inside `parentNode`.
                if (!parentElement.contains(currentNode)) return null;

                const finalPos = parseInt(posString, 10) - (options?.posAttributeOffset ?? 0);
                return [finalPos, finalPos + 1];
            }

            currentNode = currentNode.parentNode;
        }

        return null;
    }

    let pos = offset;

    let currentNode: DomNode | null = node;
    while (currentNode) {
        if (currentNode.previousSibling !== null) {
            currentNode = currentNode.previousSibling;

            const nodeSize = getContentViewInlineNodeSizeFromDom(currentNode);

            if (nodeSize.type === "Pos") {
                const finalPos = nodeSize.pos + pos;
                return [finalPos, finalPos];
            }

            pos += nodeSize.nodeSize;
        } else {
            currentNode = currentNode.parentNode;

            // `parentElement` effectively has `data-pos="0"`.
            if (currentNode === parentElement) {
                return [pos, pos];
            }

            if (currentNode instanceof Element) {
                const posString = currentNode.getAttribute("data-pos");

                if (posString !== null) {
                    // Check to see if our `data-pos` element is an inline node. If it is an inline
                    // node then discard the relative position we've been accumulating since the true
                    // size of the node is 1.
                    if (currentNode.hasAttribute("data-inline")) {
                        const finalPos =
                            parseInt(posString, 10) - (options?.posAttributeOffset ?? 0);
                        return [finalPos, finalPos + 1];
                    }

                    const finalPos =
                        parseInt(posString, 10) + pos + 1 - (options?.posAttributeOffset ?? 0);
                    return [finalPos, finalPos];
                }
            }
        }
    }

    return null;
}

/**
 * Get what would be the `nodeSize` of the provided DOM node if it were an inline
 * ProseMirror node (a node where `node.isInline` is true). The size of inline
 * nodes is equal to the size of its text data. Marks (e.g. bold) add extra
 * elements but don't contribute to node size.
 *
 * If we find the absolute position of a node then we return a `Pos` object
 * immediately that represents the absolute position at the end of this node. Since
 * this function is ultimately used for determining the position of some selection
 * in the DOM.
 */
function getContentViewInlineNodeSizeFromDom(
    node: DomNode,
    options?: {posAttributeOffset?: number},
): {type: "NodeSize"; nodeSize: number} | {type: "Pos"; pos: number} {
    if (node instanceof Text) {
        return {type: "NodeSize", nodeSize: node.data.length};
    } else if (!(node instanceof Element)) {
        return {type: "NodeSize", nodeSize: 0};
    }

    // If we find an element with `data-pos` then we know this element represents a
    // ProseMirror node. We also assume this node doesn't have inline content and has a
    // `nodeSize` of 2. If ProseMirror allows recursive text block nodes then we need
    // to update this assumption.
    //
    // Immediately return the absolute position at the end of this node instead of
    // summing up the node size.
    const posString = node.getAttribute("data-pos");
    if (posString !== null) {
        return {type: "Pos", pos: parseInt(posString, 10) + 1 - (options?.posAttributeOffset ?? 0)};
    }

    // Skip widget decorations - they don't correspond to ProseMirror content.
    if (node.hasAttribute("data-widget")) {
        return {type: "NodeSize", nodeSize: 0};
    }

    let nodeSize = 0;

    for (let i = node.childNodes.length - 1; i >= 0; i--) {
        const childNode = node.childNodes[i]!;
        const childNodeSize = getContentViewInlineNodeSizeFromDom(childNode);

        if (childNodeSize.type === "Pos") {
            return {type: "Pos", pos: childNodeSize.pos + nodeSize};
        }

        nodeSize += childNodeSize.nodeSize;
    }

    return {type: "NodeSize", nodeSize};
}
