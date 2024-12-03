/* eslint-disable @typescript-eslint/unbound-method */
// This file defines a number of helpers for wiring up user input to
// table-related functionality.

import {keydownHandler} from "prosemirror-keymap";
import {Fragment, ResolvedPos, Slice} from "prosemirror-model";
import {Command, EditorState, Selection, TextSelection, Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {deleteCellSelection} from "~/client/content/internal/table/content_table_commands.js";
import {
    contentTableCopyPasteClipCells,
    contentTableFitSlice,
    contentTableInsertCells,
    contentTablePastedCells,
} from "~/client/content/internal/table/content_table_copy_paste.js";
import {tableEditingKey} from "~/client/content/internal/table/content_table_editing_plugin.js";
import {contentTableCellAround} from "~/client/content/internal/table/helpers/content_table_cell_around.js";
import {contentTableIsInTable} from "~/client/content/internal/table/helpers/content_table_is_in_table.js";
import {contentTableNextCell} from "~/client/content/internal/table/helpers/content_table_next_cell.js";
import {contentTableSelectionCell} from "~/client/content/internal/table/helpers/content_table_selection_cell.js";
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {contentTableNodeTypes} from "~/shared/content/table/content_table_schema.js";
import {contentTableInSameTable} from "~/shared/content/table/helpers/content_table_in_same_table.js";

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

    Backspace: deleteCellSelection,
    "Mod-Backspace": deleteCellSelection,
    Delete: deleteCellSelection,
    "Mod-Delete": deleteCellSelection,
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
            const $next = contentTableNextCell($cell, axis, dir);
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

        const $head = contentTableNextCell(cellSel.$headCell, axis, dir);
        if (!$head) return false;
        return maybeSetSelection(
            state,
            dispatch,
            new ContentTableCellSelection(cellSel.$anchorCell, $head),
        );
    };
}

export function contentTableHandleTripleClick(view: EditorView, pos: number): boolean {
    const doc = view.state.doc,
        $cell = contentTableCellAround(doc.resolve(pos));
    if (!$cell) return false;
    view.dispatch(view.state.tr.setSelection(new ContentTableCellSelection($cell)));
    return true;
}

export function contentTableHandlePaste(
    view: EditorView,
    _: ClipboardEvent,
    slice: Slice,
): boolean {
    if (!contentTableIsInTable(view.state)) return false;
    let cells = contentTablePastedCells(slice);
    const sel = view.state.selection;
    if (sel instanceof ContentTableCellSelection) {
        if (!cells)
            cells = {
                width: 1,
                height: 1,
                rows: [
                    Fragment.from(
                        contentTableFitSlice(contentTableNodeTypes(view.state.schema).cell, slice),
                    ),
                ],
            };
        const table = sel.$anchorCell.node(-1);
        const start = sel.$anchorCell.start(-1);
        const rect = ContentTableMap.get(table).rectBetween(
            sel.$anchorCell.pos - start,
            sel.$headCell.pos - start,
        );
        cells = contentTableCopyPasteClipCells(
            cells,
            rect.right - rect.left,
            rect.bottom - rect.top,
        );
        contentTableInsertCells(view.state, view.dispatch, start, rect, cells);
        return true;
    } else if (cells) {
        const $cell = contentTableSelectionCell(view.state);
        const start = $cell.start(-1);
        contentTableInsertCells(
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

export function contentTableHandleMouseDown(view: EditorView, startEvent: MouseEvent): void {
    if (startEvent.ctrlKey || startEvent.metaKey) return;

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
        const starting = tableEditingKey.getState(view.state) == null;
        if (!$head || !contentTableInSameTable($anchor, $head)) {
            if (starting) $head = $anchor;
            else return;
        }
        const selection = new ContentTableCellSelection($anchor, $head);
        if (starting || !view.state.selection.eq(selection)) {
            const tr = view.state.tr.setSelection(selection);
            if (starting) tr.setMeta(tableEditingKey, $anchor.pos);
            view.dispatch(tr);
        }
    }

    // Stop listening to mouse motion events.
    function stop(): void {
        view.root.removeEventListener("mouseup", stop);
        view.root.removeEventListener("dragstart", stop);
        view.root.removeEventListener("mousemove", move);
        if (tableEditingKey.getState(view.state) != null)
            view.dispatch(view.state.tr.setMeta(tableEditingKey, -1));
    }

    function move(_event: Event): void {
        const event = _event as MouseEvent;
        const anchor = tableEditingKey.getState(view.state);
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
        if (parent.type.spec.tableRole == "cell" || parent.type.spec.tableRole == "header_cell") {
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

function cellUnderMouse(view: EditorView, event: MouseEvent): ResolvedPos | null {
    const mousePos = view.posAtCoords({
        left: event.clientX,
        top: event.clientY,
    });
    if (!mousePos) return null;
    return mousePos ? contentTableCellAround(view.state.doc.resolve(mousePos.pos)) : null;
}
