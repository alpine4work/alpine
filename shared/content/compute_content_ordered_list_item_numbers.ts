import {Node} from "prosemirror-model";
import {clampListItemIndentation} from "~/shared/content/content_schema.js";

/**
 * Compute the ordered list item numbers for any `orderedListItem` node that's
 * a direct child of the provided node. Returns a map of direct child nodes to
 * list item number.
 *
 * You may pass in a map and we'll add list item numbers there instead of
 * creating a new map.
 */
export function computeContentOrderedListItemNumbers(
    node: Node,
    orderedListItemNumberByNode: Map<Node, number> = new Map(),
): Map<Node, number> {
    let previousListItemNumberByIndent: Array<number> = [];

    node.content.forEach(childNode => {
        if (!childNode.type.groups.includes("listItem")) {
            previousListItemNumberByIndent = [];
            return;
        }

        const indent = clampListItemIndentation(childNode.attrs.indent);

        if (childNode.type.name !== "orderedListItem") {
            previousListItemNumberByIndent = previousListItemNumberByIndent.slice(0, indent);
        } else {
            // If this item's indentation level is higher than the previous item's
            // indentation level, add new counters for the new indentation levels.
            //
            // If this item's indentation level is lower than the previous item's
            // indentation level, clear deeper indentation level counters since those
            // counters are done.
            if (previousListItemNumberByIndent.length < indent + 1) {
                for (let i = previousListItemNumberByIndent.length; i < indent + 1; i++) {
                    previousListItemNumberByIndent.push(0);
                }
            } else if (previousListItemNumberByIndent.length > indent + 1) {
                previousListItemNumberByIndent = previousListItemNumberByIndent.slice(
                    0,
                    indent + 1,
                );
            }

            const previousListItemNumber = previousListItemNumberByIndent[indent]!;
            const listItemNumber = previousListItemNumber + 1;
            previousListItemNumberByIndent[indent] = listItemNumber;

            orderedListItemNumberByNode.set(childNode, listItemNumber);
        }
    });

    return orderedListItemNumberByNode;
}
