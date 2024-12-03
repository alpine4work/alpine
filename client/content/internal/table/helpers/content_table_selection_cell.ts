import {ResolvedPos} from "prosemirror-model";
import {EditorState, NodeSelection} from "prosemirror-state";
import {contentTableCellAround} from "~/client/content/internal/table/helpers/content_table_cell_around.js";
import {contentTableCellNear} from "~/client/content/internal/table/helpers/content_table_cell_near.js";
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";

/**
 * Retrieves the resolved position of the currently selected table cell in the editor state.
 *
 * Example usage:
 * const selectedCellPos = selectionCell(editorState);
 * console.log(`Selected cell position: ${selectedCellPos.pos}`);
 *
 * This function is useful when you need to perform operations on the selected cell, such as
 * modifying its attributes or content.
 */
export function contentTableSelectionCell(state: EditorState): ResolvedPos {
    const sel = state.selection as ContentTableCellSelection | NodeSelection;
    if ("$anchorCell" in sel && sel.$anchorCell) {
        return sel.$anchorCell.pos > sel.$headCell.pos ? sel.$anchorCell : sel.$headCell;
    } else if ("node" in sel && sel.node && sel.node.type.spec.tableRole == "cell") {
        return sel.$anchor;
    }
    const $cell = contentTableCellAround(sel.$head) || contentTableCellNear(sel.$head);
    if ($cell) {
        return $cell;
    }
    throw new RangeError(`No cell found around position ${sel.head}`);
}
