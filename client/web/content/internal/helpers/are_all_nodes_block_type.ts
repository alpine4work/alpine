import {Attrs, Node, NodeType} from "prosemirror-model";

/**
 * Are all nodes the provided block type?
 *
 * If true then we expect `createToggleBlockTypeCommand()` to toggle the block type
 * off.
 */
export function areAllNodesBlockType(
    parentNode: Node,
    range: {from: number; to: number},
    nodeType: NodeType,
    attrs: Attrs | null = null,
): boolean {
    let areAllNodesBlockType: boolean | undefined;

    parentNode.nodesBetween(range.from, range.to, node => {
        if (areAllNodesBlockType === false) return false;
        if (!node.isTextblock) return;

        if (node.hasMarkup(nodeType, attrs)) {
            areAllNodesBlockType = true;
            return;
        }

        areAllNodesBlockType = false;
    });

    return areAllNodesBlockType ?? false;
}
