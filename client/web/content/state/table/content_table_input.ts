/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove features
 * we don't use and customize the user experience. You can find the original file
 * in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/input.ts
 *
 * The MIT License
 *
 * Copyright (C) 2015-2016 by Marijn Haverbeke <marijnh@gmail.com> and others
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
 * FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
 * COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
 * IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

// This file defines a number of helpers for wiring up user input to table-related
// functionality.

import {keydownHandler} from "prosemirror-keymap";
import {Fragment, Node, Slice} from "prosemirror-model";
import {Command, EditorState, Selection, TextSelection, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    getContentTableIfExists,
    isSelectionInContentTable,
    nextContentTableCell,
    selectionContentTableCell,
} from "~/client/web/content/state/table/content_table_client_util.js";
import {deleteContentTableCellSelection} from "~/client/web/content/state/table/content_table_commands.js";
import {
    clipContentTableCells,
    fitSlice,
    insertContentTableCells,
    pastedContentTableCells,
} from "~/client/web/content/state/table/content_table_copy_paste.js";
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";

type Axis = "horiz" | "vert";

export type ContentTableInputDirection = -1 | 1;

export const handleContentTableKeyDown = keydownHandler({
    ArrowLeft: arrow("horiz", -1),
    ArrowRight: arrow("horiz", 1),
    ArrowUp: arrow("vert", -1),
    ArrowDown: arrow("vert", 1),

    "Shift-ArrowLeft": shiftArrow("horiz", -1),
    "Shift-ArrowRight": shiftArrow("horiz", 1),
    "Shift-ArrowUp": shiftArrow("vert", -1),
    "Shift-ArrowDown": shiftArrow("vert", 1),

    Backspace: deleteContentTableCellSelection,
    "Mod-Backspace": deleteContentTableCellSelection,
    Delete: deleteContentTableCellSelection,
    "Mod-Delete": deleteContentTableCellSelection,
});

function maybeSetSelection(
    state: EditorState,
    dispatch: undefined | ((tr: Transaction) => void),
    selection: Selection,
): boolean {
    if (selection.eq(state.selection)) return false;
    if (dispatch) dispatch(state.tr.setSelection(selection).scrollIntoView());
    return true;
}

function arrow(axis: Axis, dir: ContentTableInputDirection): Command {
    return (state, dispatch, view) => {
        if (!view) return false;
        const sel = state.selection;
        if (sel instanceof ContentTableCellSelection) {
            return maybeSetSelection(
                state,
                dispatch,
                // Create a text selection at the start of the head cell.
                Selection.near(sel.$headCell, 1),
            );
        }

        // Arrow up/down for selections that aren't cell selection is handled by
        // `content_editor_keymap_plugin.ts`'s `selectVertically()` function.
        if (axis === "vert") return false;

        if (axis != "horiz" && !sel.empty) return false;
        const end = atEndOfCell(view, axis, dir, false);
        if (end == null) return false;
        if (axis == "horiz") {
            return maybeSetSelection(
                state,
                dispatch,
                Selection.near(state.doc.resolve(sel.head + dir), dir),
            );
        } else {
            const $cell = state.doc.resolve(end);
            const $next = nextContentTableCell($cell, axis, dir);
            let newSel;
            if ($next) newSel = Selection.near($next, 1);
            else if (dir < 0) newSel = Selection.near(state.doc.resolve($cell.before(-1)), -1);
            else newSel = Selection.near(state.doc.resolve($cell.after(-1)), 1);
            return maybeSetSelection(state, dispatch, newSel);
        }
    };
}

function shiftArrow(axis: Axis, dir: ContentTableInputDirection): Command {
    return (state, dispatch, view) => {
        if (!view) return false;
        const sel = state.selection;
        let cellSel: ContentTableCellSelection;
        if (sel instanceof ContentTableCellSelection) {
            cellSel = sel;
        } else {
            // We only turn this shift-arrow key press into a cell selection if both the
            // selection head and anchor are in the same table.
            const selHeadTable = getContentTableIfExists(sel.$head);
            const selAnchorTable = getContentTableIfExists(sel.$anchor);
            if (!selHeadTable || !selAnchorTable) return false;
            if (selHeadTable !== selAnchorTable) return false;

            const end = atEndOfCell(view, axis, dir, true);
            if (end == null) return false;
            cellSel = new ContentTableCellSelection(state.doc.resolve(end));
        }

        const $head = nextContentTableCell(cellSel.$headCell, axis, dir);
        if (!$head) return false;
        return maybeSetSelection(
            state,
            dispatch,
            new ContentTableCellSelection(cellSel.$anchorCell, $head),
        );
    };
}

export function handleContentTablePaste(
    doc: Node,
    selection: Selection,
    createTransaction: () => Transaction,
    dispatch: (transaction: Transaction) => void,
    slice: Slice,
): boolean {
    if (!isSelectionInContentTable(selection)) return false;

    let cells = pastedContentTableCells(slice);
    if (selection instanceof ContentTableCellSelection) {
        const {schema} = selection.$anchor.doc.type;

        if (!cells) {
            cells = {
                width: 1,
                height: 1,
                rows: [Fragment.from(fitSlice(schema.nodes.tableCell!, slice))],
            };
        }
        const table = selection.$anchorCell.node(-1);
        const start = selection.$anchorCell.start(-1);
        const rect = ContentTableMap.get(table).rectBetween(
            selection.$anchorCell.pos - start,
            selection.$headCell.pos - start,
        );
        cells = clipContentTableCells(cells, rect.right - rect.left, rect.bottom - rect.top);
        insertContentTableCells(doc, createTransaction, dispatch, start, rect, cells);
        return true;
    } else if (cells) {
        const $cell = selectionContentTableCell(selection);
        const start = $cell.start(-1);
        insertContentTableCells(
            doc,
            createTransaction,
            dispatch,
            start,
            ContentTableMap.get($cell.node(-1)).findCell($cell.pos - start),
            cells,
        );
        return true;
    } else {
        return false;
    }
}

// Check whether the cursor is at the end of a cell (so that further motion would
// move out of the cell)
function atEndOfCell(view: EditorView, axis: Axis, dir: number, shiftKey: boolean): null | number {
    if (!(view.state.selection instanceof TextSelection)) return null;

    const {$head} = view.state.selection;

    for (let d = $head.depth - 1; d >= 0; d--) {
        const parent = $head.node(d),
            index = dir < 0 ? $head.index(d) : $head.indexAfter(d);

        if (index != (dir < 0 ? 0 : parent.childCount)) return null;

        if (parent.type.name === "tableCell") {
            const cellPos = $head.before(d);
            const dirStr: "up" | "down" | "left" | "right" =
                axis == "vert" ? (dir > 0 ? "down" : "up") : dir > 0 ? "right" : "left";

            if (!view.endOfTextblock(dirStr)) return null;

            // If the user is holding shift then we only want to move into cell selection if
            // they are both at the last line of the textblock and they're at the end of
            // content in the textblock.
            //
            // This mirrors a similar check in `content_editor_keymap_plugin.ts`'s
            // `selectVertically()` function.
            if (
                shiftKey &&
                axis === "vert" &&
                $head.parentOffset !== (dir > 0 ? $head.parent.nodeSize - 2 : 0)
            ) {
                return null;
            }

            return cellPos;
        }
    }

    return null;
}
