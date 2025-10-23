import {Node} from "prosemirror-model";

/**
 * Checks if two ProseMirror nodes are equal except for text. Useful for checking
 * if the structure of two nodes is equal ignoring minor updates.
 */
export function areProsemirrorNodesEqualExceptText(node1: Node, node2: Node): boolean {
    if (node1 === node2) return true;
    if (!node1.sameMarkup(node2)) return false;
    if (node1.content.content.length !== node2.content.content.length) return false;

    for (let i = 0; i < node1.content.content.length; i++) {
        if (
            !areProsemirrorNodesEqualExceptText(
                node1.content.content[i]!,
                node2.content.content[i]!,
            )
        ) {
            return false;
        }
    }

    return true;
}
