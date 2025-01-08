import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    isInContentTable,
    isRowSelected,
    isTableSelected,
} from "~/client/content/internal/table/content_table_client_util.js";

export function isRowGripSelected({view, state}: {view: EditorView; state: EditorState}) {
    if (!isInContentTable(state) || isTableSelected(state.selection)) {
        return false;
    }

    // check 1: where we use current position
    const cursorNumberPos = state.selection.$from.pos;
    const domAtPos = view.domAtPos(cursorNumberPos).node as HTMLElement;
    const nodeDOM = view.nodeDOM(cursorNumberPos) as HTMLElement;
    const node = nodeDOM || domAtPos;

    if (!node) {
        return false;
    }

    // find the relavant table for this node
    const table = node.parentElement?.closest("table");
    if (!table) {
        return false;
    }

    // Find any grip-column element with the selected class
    const selectedGrip = table.querySelector("a.grip-row.selected");
    return !!selectedGrip;
}
