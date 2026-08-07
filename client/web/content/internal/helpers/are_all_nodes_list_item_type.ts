import {Node, NodeType} from "prosemirror-model";
import {findWrapping} from "prosemirror-transform";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * Are all nodes the provided list item type?
 *
 * If true then we expect `createToggleListItemsCommand()` to toggle the block type
 * off.
 */
export function areAllNodesListItemType(
    parentNode: Node,
    range: {from: number; to: number},
    nodeType: NodeType,
) {
    assert(nodeType.groups.includes("listItem"));

    let areAllNodesListItemType: boolean | undefined;

    parentNode.nodesBetween(range.from, range.to, (node, pos) => {
        if (areAllNodesListItemType === false) return false;

        const $pos = parentNode.resolve(pos);
        const blockRange = $pos.blockRange(parentNode.resolve(pos + node.nodeSize));

        if (blockRange) {
            if (node.type === nodeType) {
                areAllNodesListItemType = true;
            } else if (node.type.groups.includes("listItem")) {
                areAllNodesListItemType = false;
            } else if (node.isTextblock) {
                const wrapping = findWrapping(blockRange, nodeType);
                if (wrapping) {
                    areAllNodesListItemType = false;
                }
            }
        }
    });

    return areAllNodesListItemType ?? false;
}
