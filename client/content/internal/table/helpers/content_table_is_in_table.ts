import {EditorState} from "prosemirror-state";

/**
 * Checks if the current selection is within a table.
 *
 * Example usage:
 * const inTable = isInTable(state);
 * console.log(`Is in table: ${inTable}`);
 *
 * This function is useful for validating if operations should be performed within a table context.
 */
export function contentTableIsInTable(state: EditorState): boolean {
    const $head = state.selection.$head;
    for (let d = $head.depth; d > 0; d--)
        if ($head.node(d).type.spec.tableRole == "row") return true;
    return false;
}
