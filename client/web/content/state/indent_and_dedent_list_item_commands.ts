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

    let failed = false;
    const transaction = state.tr;
    const indented = new Set();

    // 1. Iterate through all the nodes in the selection.
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
        // 2. All of the top-level nodes in the selection should be list items.
        if (!node.type.groups.includes("listItem")) {
            failed = true;
            return false;
        }

        // If we already failed we can stop processing.
        if (failed) return false;

        // 3. All nodes preceding the target list items should also be list items.
        const lastNode = pos - 1 >= 0 ? state.doc.resolve(pos - 1).node() : null;
        if (!lastNode || !lastNode.type.groups.includes("listItem")) {
            failed = true;
            return false;
        }

        // 4. Indent each list item node by one, but don't indent past our max indentation
        //    level.
        const newIndent = Math.min(node.attrs.indent + 1, maxContentListItemIndentation);

        const lastNodeIndent = lastNode.attrs.indent + (indented.has(lastNode) ? 1 : 0);

        // 5. Our node's indentation must be less than or equal to the last node's
        //    indentation. This way we're either "attached" to the node or assume that the
        //    last node is correctly attached to a parent itself.
        if (newIndent > lastNodeIndent + 1) {
            failed = true;
            return false;
        }

        // 6. Actually update the node's indentation attribute.
        transaction.setNodeMarkup(pos, node.type, {
            ...node.attrs,
            indent: newIndent,
        });

        indented.add(node);
        return false;
    });

    // 7. Only perform the indentation if all nodes in the selection can be indented.
    if (failed) return false;
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

    let failed = false;
    const transaction = state.tr;

    // 1. Iterate through all the nodes in the selection.
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
        // 2. All of the top-level nodes in the selection should be list items.
        if (!node.type.groups.includes("listItem")) {
            failed = true;
            return false;
        }

        // If we already failed we can stop processing.
        if (failed) return false;

        // 3. Don't dedent if this list item already doesn't have any indentation.
        if (node.attrs.indent === 0) {
            failed = true;
            return false;
        }

        // 4. Dedent each list item node by one.
        const newIndent = node.attrs.indent - 1;

        // 5. If we have a list item after this node then our node's indentation must be
        //    less than or equal to the next node's indentation. This way we don't
        //    accidentally detach our node.
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
                failed = true;
                return false;
            }
        }

        // 6. Actually update the node's indentation attribute.
        transaction.setNodeMarkup(pos, node.type, {
            ...node.attrs,
            indent: newIndent,
        });

        return false;
    });

    // 7. Only perform the indentation if all nodes in the selection can be dedented.
    if (failed) return false;
    if (dispatch) dispatch(transaction.scrollIntoView());
    return true;
};
