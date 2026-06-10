import {Command} from "prosemirror-state";
import {trimSelectionInvisibleExtensionIntoAdjacentNodes} from "~/client/web/content/state/trim_selection_invisible_extension_into_adjacent_nodes.js";
import {maxContentListItemIndentation} from "~/shared/content/content_schema.js";

/**
 * Indent all list items in a selection. Only indents if all the selected list
 * items can be successfully indented.
 *
 * While it is possible to create valid documents with what this command might
 * consider "invalid" indentation we force an indent to be valid when pressing tab.
 * This helps users stay within the pit of success.
 *
 * For example, if the cursor is at `|`:
 *
 * ```
 * - test
 * - test|
 * ```
 *
 * Then you press tab:
 *
 * ```
 * - test
 *   - test|
 * ```
 */
export const indentListItemCommand: Command = (state, dispatch) => {
    const {$from, $to} = trimSelectionInvisibleExtensionIntoAdjacentNodes(state.selection);

    // Find which list item (if any) contains the start of the selection.
    let fromListItemDepth: number | null = null;
    let fromListItemIndex: number | null = null;
    for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.groups.includes("listItem")) {
            fromListItemDepth = d;
            fromListItemIndex = $from.index(d - 1);
            break;
        }
    }

    // Find which list item (if any) contains the end of the selection.
    let toListItemDepth: number | null = null;
    let toListItemIndex: number | null = null;
    for (let d = $to.depth; d > 0; d--) {
        if ($to.node(d).type.groups.includes("listItem")) {
            toListItemDepth = d;
            toListItemIndex = $to.index(d - 1);
            break;
        }
    }

    // Both selection endpoints must be within list items at the same depth.
    if (
        fromListItemDepth === null ||
        toListItemDepth === null ||
        fromListItemDepth !== toListItemDepth ||
        fromListItemIndex === null ||
        toListItemIndex === null
    ) {
        return false;
    }

    // Both endpoints must have the same parent (otherwise they're not siblings).
    if ($from.node(fromListItemDepth - 1) !== $to.node(toListItemDepth - 1)) {
        return false;
    }

    const listItemDepth = fromListItemDepth;
    const parent = $from.node(listItemDepth - 1);

    // Validate that all nodes between fromIndex and toIndex (inclusive) are list
    // items.
    for (let i = fromListItemIndex; i <= toListItemIndex; i++) {
        const node = parent.child(i);
        if (!node.type.groups.includes("listItem")) {
            return false;
        }
    }

    // Now perform the indentation.
    const transaction = state.tr;
    const indented = new Set();

    let runningPos = $from.start(listItemDepth - 1);
    for (let i = 0; i < fromListItemIndex; i++) {
        runningPos += parent.child(i).nodeSize;
    }

    for (let i = fromListItemIndex; i <= toListItemIndex; i++) {
        const node = parent.child(i);
        const pos = runningPos;
        runningPos += node.nodeSize;

        // All nodes preceding the target list items should also be list items.
        const lastNode = pos - 1 >= 0 ? state.doc.resolve(pos - 1).node() : null;
        if (!lastNode || !lastNode.type.groups.includes("listItem")) {
            return false;
        }

        // Indent each list item node by one, but don't indent past our max indentation
        // level.
        const newIndent = Math.min(node.attrs.indent + 1, maxContentListItemIndentation);

        const lastNodeIndent = lastNode.attrs.indent + (indented.has(lastNode) ? 1 : 0);

        // Our node's indentation must be less than or equal to the last node's
        // indentation. This way we're either "attached" to the node or assume that the
        // last node is correctly attached to a parent itself.
        if (newIndent > lastNodeIndent + 1) {
            return false;
        }

        // Actually update the node's indentation attribute.
        transaction.setNodeMarkup(pos, node.type, {
            ...node.attrs,
            indent: newIndent,
        });

        indented.add(node);
    }

    if (dispatch) dispatch(transaction.scrollIntoView());
    return true;
};

/**
 * Dedent all list items in a selection. Only dedents if all the selected list
 * items can be successfully dedented.
 *
 * For example, if the cursor is at `|`:
 *
 * ```
 * - test
 *   - test|
 * ```
 *
 * Then you press shift-tab:
 *
 * ```
 * - test
 * - test|
 * ```
 */
export const dedentListItemCommand: Command = (state, dispatch) => {
    const {$from, $to} = trimSelectionInvisibleExtensionIntoAdjacentNodes(state.selection);

    // Find which list item (if any) contains the start of the selection.
    let fromListItemDepth: number | null = null;
    let fromListItemIndex: number | null = null;
    for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.groups.includes("listItem")) {
            fromListItemDepth = d;
            fromListItemIndex = $from.index(d - 1);
            break;
        }
    }

    // Find which list item (if any) contains the end of the selection.
    let toListItemDepth: number | null = null;
    let toListItemIndex: number | null = null;
    for (let d = $to.depth; d > 0; d--) {
        if ($to.node(d).type.groups.includes("listItem")) {
            toListItemDepth = d;
            toListItemIndex = $to.index(d - 1);
            break;
        }
    }

    // Both selection endpoints must be within list items at the same depth.
    if (
        fromListItemDepth === null ||
        toListItemDepth === null ||
        fromListItemDepth !== toListItemDepth ||
        fromListItemIndex === null ||
        toListItemIndex === null
    ) {
        return false;
    }

    // Both endpoints must have the same parent (otherwise they're not siblings).
    if ($from.node(fromListItemDepth - 1) !== $to.node(toListItemDepth - 1)) {
        return false;
    }

    const listItemDepth = fromListItemDepth;
    const parent = $from.node(listItemDepth - 1);

    // Validate that all nodes between fromIndex and toIndex (inclusive) are list
    // items.
    for (let i = fromListItemIndex; i <= toListItemIndex; i++) {
        const node = parent.child(i);
        if (!node.type.groups.includes("listItem")) {
            return false;
        }
    }

    // Now perform the dedentation.
    const transaction = state.tr;

    let runningPos = $from.start(listItemDepth - 1);
    for (let i = 0; i < fromListItemIndex; i++) {
        runningPos += parent.child(i).nodeSize;
    }

    for (let i = fromListItemIndex; i <= toListItemIndex; i++) {
        const node = parent.child(i);
        const pos = runningPos;
        runningPos += node.nodeSize;

        // Don't dedent if this list item already doesn't have any indentation.
        if (node.attrs.indent === 0) {
            return false;
        }

        // Dedent each list item node by one.
        const newIndent = node.attrs.indent - 1;

        // If we have a list item after this node then our node's indentation must be less
        // than or equal to the next node's indentation. This way we don't accidentally
        // detach our node.
        const $nextNodePos =
            pos + node.content.size + 3 <= state.doc.content.size
                ? state.doc.resolve(pos + node.content.size + 3)
                : null;
        if ($nextNodePos?.node().type.groups.includes("listItem")) {
            let nextNodeIndent = $nextNodePos.node().attrs.indent;

            // If the next node is within the selection then it'll be dedented too.
            if ($from.pos <= $nextNodePos.pos && $nextNodePos.pos <= $to.pos) {
                nextNodeIndent -= 1;
            }

            if (nextNodeIndent > newIndent + 1) {
                return false;
            }
        }

        // Actually update the node's indentation attribute.
        transaction.setNodeMarkup(pos, node.type, {
            ...node.attrs,
            indent: newIndent,
        });
    }

    if (dispatch) dispatch(transaction.scrollIntoView());
    return true;
};
