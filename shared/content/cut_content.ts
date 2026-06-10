import {Node} from "prosemirror-model";
import {computeContentOrderedListItemNumbers} from "~/shared/content/compute_content_ordered_list_item_numbers.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

/**
 * Creates a copy of the provided content between the `from` and `to` positions.
 * Same as ProseMirror's `Node.cut()` method but makes sure ordered list items
 * maintain the right numbering in the cut `Node` (using the `orderStart`
 * attribute).
 */
export function cutContent(
    content: Node,
    from: number,
    to: number = content.content.size,
    orderedListItemNumberByNode: Map<Node, number> = new Map(),
): Node {
    let cutContent = content.cut(from, to);

    const $from = content.resolve(from);
    const $to = content.resolve(to);

    let fromOrderedListItemState: {parentNode: Node; node: Node} | null = null;
    let toOrderedListItemState: {parentNode: Node; node: Node} | null = null;

    if ($from.nodeAfter?.type.name === "orderedListItem") {
        fromOrderedListItemState = {parentNode: $from.parent, node: $from.nodeAfter};
    } else {
        for (let depth = $from.depth; depth > 0; depth--) {
            const node = $from.node(depth);
            if (node.type.name === "orderedListItem") {
                fromOrderedListItemState = {parentNode: $from.node(depth - 1), node};
                break;
            }
        }
    }

    if ($to.nodeBefore?.type.name === "orderedListItem") {
        toOrderedListItemState = {parentNode: $to.parent, node: $to.nodeBefore};
    } else {
        for (let depth = $to.depth; depth > 0; depth--) {
            const node = $to.node(depth);
            if (node.type.name === "orderedListItem") {
                toOrderedListItemState = {parentNode: $to.node(depth - 1), node};
                break;
            }
        }
    }

    if (fromOrderedListItemState !== null) {
        let firstOrderedListItemOrderStart =
            orderedListItemNumberByNode.get(fromOrderedListItemState.node) ?? null;

        let lastOrderedListItemOrderStart =
            toOrderedListItemState !== null
                ? (orderedListItemNumberByNode.get(toOrderedListItemState.node) ?? null)
                : null;

        if (firstOrderedListItemOrderStart === null) {
            computeContentOrderedListItemNumbers(
                fromOrderedListItemState.parentNode,
                orderedListItemNumberByNode,
            );

            firstOrderedListItemOrderStart = assertExists(
                orderedListItemNumberByNode.get(fromOrderedListItemState.node),
            );
        }

        if (toOrderedListItemState !== null && lastOrderedListItemOrderStart === null) {
            computeContentOrderedListItemNumbers(
                toOrderedListItemState.parentNode,
                orderedListItemNumberByNode,
            );

            lastOrderedListItemOrderStart = assertExists(
                orderedListItemNumberByNode.get(toOrderedListItemState.node),
            );
        }

        cutContent = setFirstOrderedListItemOrderStart(
            cutContent,
            fromOrderedListItemState,
            toOrderedListItemState,
            firstOrderedListItemOrderStart,
            lastOrderedListItemOrderStart,
            orderedListItemNumberByNode,
        );
    }

    return cutContent;
}

function setFirstOrderedListItemOrderStart(
    node: Node,
    fromOrderedListItemState: {parentNode: Node; node: Node},
    toOrderedListItemState: {parentNode: Node; node: Node} | null,
    firstOrderedListItemOrderStart: number,
    lastOrderedListItemOrderStart: number | null,
    orderedListItemNumberByNode: Map<Node, number>,
): Node {
    if (node.content.content[0]?.type.name !== "orderedListItem") {
        if (node.content.content.length === 0) {
            return node;
        } else {
            return node.type.create(
                node.attrs,
                [
                    setFirstOrderedListItemOrderStart(
                        node.content.content[0]!,
                        fromOrderedListItemState,
                        toOrderedListItemState,
                        firstOrderedListItemOrderStart,
                        lastOrderedListItemOrderStart,
                        orderedListItemNumberByNode,
                    ),
                    ...node.content.content.slice(1),
                ],
                node.marks,
            );
        }
    }

    let workingIndent: number | null = Infinity;

    const content = node.content.content.map((childNode, index) => {
        if (workingIndent === null) return childNode;

        if (!childNode.type.groups.includes("listItem")) {
            workingIndent = null;
            return childNode;
        }

        // The order should be fine at this indentation.
        if (childNode.attrs.indent > workingIndent) return childNode;

        // We'll set `orderStart` for the first node at this indentation. Then only set
        // `orderStart` for the first node at the next indentation.
        workingIndent = childNode.attrs.indent - 1;

        if (childNode.type.name !== "orderedListItem") return childNode;

        const orderStart =
            index === 0
                ? firstOrderedListItemOrderStart
                : fromOrderedListItemState.parentNode === toOrderedListItemState?.parentNode &&
                    lastOrderedListItemOrderStart !== null &&
                    index === node.content.content.length - 1
                  ? lastOrderedListItemOrderStart
                  : assertExists(orderedListItemNumberByNode.get(childNode));

        if (orderStart === 1) return childNode;

        return childNode.type.create(
            {...childNode.attrs, orderStart},
            childNode.content.content,
            childNode.marks,
        );
    });

    return node.type.create(node.attrs, content, node.marks);
}
