/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove
 * features we don't use and customize the user experience. You can find the
 * original file in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/input.ts
 *
 * The MIT License
 *
 * Copyright (C) 2015-2016 by Marijn Haverbeke <marijnh@gmail.com> and others
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

// This file defines a number of helpers for wiring up user input to
// table-related functionality.

import {keydownHandler} from "prosemirror-keymap";
import {Fragment, ResolvedPos, Slice} from "prosemirror-model";
import {Command, EditorState, Selection, TextSelection, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    contentTableCellAround,
    contentTableEditingKey,
    isInContentTable,
    nextContentTableCell,
    selectionContentTableCell,
} from "~/client/content/internal/table/content_table_client_util.js";
import {contentTableColumnResizingPluginKey} from "~/client/content/internal/table/content_table_column_resizing_plugin.js";
import {deleteContentTableCellSelection} from "~/client/content/internal/table/content_table_commands.js";
import {
    clipContentTableCells,
    fitSlice,
    insertContentTableCells,
    pastedContentTableCells,
} from "~/client/content/internal/table/content_table_copy_paste.js";
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {contentTableNodeTypes} from "~/shared/content/table/content_table_schema.js";
import {inSameContentTable} from "~/shared/content/table/content_table_shared_util.js";

type Axis = "horiz" | "vert";

export type ContentTableInputDirection = -1 | 1;

export const contentTableKeyDownHandler = keydownHandler({
    ArrowLeft: arrow("horiz", -1),
    ArrowRight: arrow("horiz", 1),
    ArrowUp: arrow("vert", -1),
    ArrowDown: arrow("vert", 1),

    "Shift-ArrowLeft": shiftArrow("horiz", -1),
    "Shift-ArrowRight": shiftArrow("horiz", 1),
    "Shift-ArrowUp": shiftArrow("vert", -1),
    "Shift-ArrowDown": shiftArrow("vert", 1),

    Tab: arrow("horiz", 1),
    "Shift-Tab": arrow("horiz", -1),

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
            return maybeSetSelection(state, dispatch, Selection.near(sel.$headCell, dir));
        }
        if (axis != "horiz" && !sel.empty) return false;
        const end = atEndOfCell(view, axis, dir);
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
            const end = atEndOfCell(view, axis, dir);
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

export function handleContentTableTripleClick(view: EditorView, pos: number): boolean {
    const doc = view.state.doc,
        $cell = contentTableCellAround(doc.resolve(pos));
    if (!$cell) return false;
    view.dispatch(view.state.tr.setSelection(new ContentTableCellSelection($cell)));
    return true;
}

export function handleContentTablePaste(
    view: EditorView,
    _: ClipboardEvent,
    slice: Slice,
): boolean {
    if (!isInContentTable(view.state)) return false;
    let cells = pastedContentTableCells(slice);
    const sel = view.state.selection;
    if (sel instanceof ContentTableCellSelection) {
        if (!cells)
            cells = {
                width: 1,
                height: 1,
                rows: [
                    Fragment.from(fitSlice(contentTableNodeTypes(view.state.schema).cell, slice)),
                ],
            };
        const table = sel.$anchorCell.node(-1);
        const start = sel.$anchorCell.start(-1);
        const rect = ContentTableMap.get(table).rectBetween(
            sel.$anchorCell.pos - start,
            sel.$headCell.pos - start,
        );
        cells = clipContentTableCells(cells, rect.right - rect.left, rect.bottom - rect.top);
        insertContentTableCells(view.state, view.dispatch, start, rect, cells);
        return true;
    } else if (cells) {
        const $cell = selectionContentTableCell(view.state);
        const start = $cell.start(-1);
        insertContentTableCells(
            view.state,
            view.dispatch,
            start,
            ContentTableMap.get($cell.node(-1)).findCell($cell.pos - start),
            cells,
        );
        return true;
    } else {
        return false;
    }
}

// Handle mouse down event for table, responsible for creating a cell selection
// when the user drags over a cell
export function handleContentTableMouseDown(view: EditorView, startEvent: MouseEvent): void {
    if (startEvent.ctrlKey || startEvent.metaKey) return;

    // if the user is resizing a column, don't create a cell selection
    const resizeState = contentTableColumnResizingPluginKey.getState(view.state);
    if (resizeState && (resizeState.activeHandle > -1 || resizeState.dragging)) return;

    const startDOMCell = domInCell(view, startEvent.target as Node);
    let $anchor;
    if (startEvent.shiftKey && view.state.selection instanceof ContentTableCellSelection) {
        // Adding to an existing cell selection
        setCellSelection(view.state.selection.$anchorCell, startEvent);
        startEvent.preventDefault();
    } else if (
        startEvent.shiftKey &&
        startDOMCell &&
        ($anchor = contentTableCellAround(view.state.selection.$anchor)) != null &&
        cellUnderMouse(view, startEvent)?.pos != $anchor.pos
    ) {
        // Adding to a selection that starts in another cell (causing a
        // cell selection to be created).
        setCellSelection($anchor, startEvent);
        startEvent.preventDefault();
    } else if (!startDOMCell) {
        // Not in a cell, let the default behavior happen.
        return;
    }

    // Create and dispatch a cell selection between the given anchor and
    // the position under the mouse.
    function setCellSelection($anchor: ResolvedPos, event: MouseEvent): void {
        let $head = cellUnderMouse(view, event);
        const starting = contentTableEditingKey.getState(view.state) == null;
        if (!$head || !inSameContentTable($anchor, $head)) {
            if (starting) $head = $anchor;
            else return;
        }
        const selection = new ContentTableCellSelection($anchor, $head);
        if (starting || !view.state.selection.eq(selection)) {
            const tr = view.state.tr.setSelection(selection);
            if (starting) tr.setMeta(contentTableEditingKey, $anchor.pos);
            view.dispatch(tr);
        }
    }

    // Stop listening to mouse motion events.
    function stop(): void {
        view.root.removeEventListener("mouseup", stop);
        view.root.removeEventListener("dragstart", stop);
        view.root.removeEventListener("mousemove", move);
        if (contentTableEditingKey.getState(view.state) != null)
            view.dispatch(view.state.tr.setMeta(contentTableEditingKey, -1));
    }

    function move(_event: Event): void {
        // console.log("move", {_event});
        const event = _event as MouseEvent;
        const anchor = contentTableEditingKey.getState(view.state);
        let $anchor;
        if (anchor != null) {
            // Continuing an existing cross-cell selection
            $anchor = view.state.doc.resolve(anchor);
        } else if (domInCell(view, event.target as Node) != startDOMCell) {
            // Moving out of the initial cell -- start a new cell selection
            $anchor = cellUnderMouse(view, startEvent);
            if (!$anchor) return stop();
        }
        if ($anchor) setCellSelection($anchor, event);
    }

    view.root.addEventListener("mouseup", stop);
    view.root.addEventListener("dragstart", stop);
    view.root.addEventListener("mousemove", move);
}

// Check whether the cursor is at the end of a cell (so that further
// motion would move out of the cell)
function atEndOfCell(view: EditorView, axis: Axis, dir: number): null | number {
    if (!(view.state.selection instanceof TextSelection)) return null;
    const {$head} = view.state.selection;
    for (let d = $head.depth - 1; d >= 0; d--) {
        const parent = $head.node(d),
            index = dir < 0 ? $head.index(d) : $head.indexAfter(d);
        if (index != (dir < 0 ? 0 : parent.childCount)) return null;
        if (parent.type.spec.tableRole == "cell") {
            const cellPos = $head.before(d);
            const dirStr: "up" | "down" | "left" | "right" =
                axis == "vert" ? (dir > 0 ? "down" : "up") : dir > 0 ? "right" : "left";
            return view.endOfTextblock(dirStr) ? cellPos : null;
        }
    }
    return null;
}

function domInCell(view: EditorView, dom: Node | null): Node | null {
    for (; dom && dom != view.dom; dom = dom.parentNode) {
        if (dom.nodeName == "TD" || dom.nodeName == "TH") {
            return dom;
        }
    }
    return null;
}

// Find the cell under the mouse
function cellUnderMouse(view: EditorView, event: MouseEvent): ResolvedPos | null {
    const mousePos = view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
    });
    if (!mousePos) return null;
    return mousePos ? contentTableCellAround(view.state.doc.resolve(mousePos.pos)) : null;
}
