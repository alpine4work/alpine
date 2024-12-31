/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove
 * features we don't use and customize the user experience. You can find the
 * original file in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/columnresizing.ts
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

import {EditorState, Plugin, PluginKey, Transaction} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {updateContentTableColumnsOnResize} from "~/client/content/internal/table/content_editor_table_node_view.js";
import {contentTableCellAround} from "~/client/content/internal/table/content_table_client_util.js";
import {getTableUnitPxWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {pointsAtContentTableCell} from "~/shared/content/table/content_table_shared_util.js";

export const contentTableColumnResizingPluginKey = new PluginKey<ContentTableColumnResizeState>(
    "contentTableColumnResizing",
);

type ColumnResizingOptions = {
    handleWidth?: number;
    /**
     * Minimum width of a cell /column. The column cannot be resized smaller than this.
     */
    cellMinWidth?: number;
    /**
     * The default minWidth of a cell / column when it doesn't have an explicit width (i.e.: it has not been resized manually)
     */
    defaultCellMinWidth?: number;
    lastColumnResizable?: boolean;
};

type Dragging = {startX: number; startWidth: number};

// The contentTableColumnResizingPlugin sets up event handlers for mouse events
// related to column resizing. When the user clicks and drags on a column border,
// the handleMouseDown function is called, which initiates the column resizing
// process. As the user drags the mouse, the move function is called repeatedly,
// updating the column width based on the mouse position. When the user releases
// the mouse button, the finish function is called, which commits the column
// width changes.
export function contentTableColumnResizingPlugin({
    handleWidth = 5,
    cellMinWidth = 6.25,
    defaultCellMinWidth = 6.25,
    lastColumnResizable = true,
}: ColumnResizingOptions = {}): Plugin {
    const plugin = new Plugin<ContentTableColumnResizeState>({
        key: contentTableColumnResizingPluginKey,
        state: {
            init() {
                return new ContentTableColumnResizeState(-1, false);
            },
            apply(tr, prev) {
                return prev.apply(tr);
            },
        },
        props: {
            attributes: (state): Record<string, string> => {
                const pluginState = contentTableColumnResizingPluginKey.getState(state);
                return pluginState && pluginState.activeHandle > -1
                    ? {class: contentStyles.withTableColumnResizeCursor}
                    : {};
            },

            handleDOMEvents: {
                // Handles mouse movement to update the active column handle
                mousemove: (view, event) => {
                    handleMouseMove(view, event, handleWidth, lastColumnResizable);
                },
                // Handles mouse leave event to reset the active handle
                mouseleave: view => {
                    handleMouseLeave(view);
                },
                // Initiates the column resizing process on mouse down
                mousedown: (view, event) => {
                    handleMouseDown(view, event, cellMinWidth, defaultCellMinWidth);
                },
            },

            decorations: state => {
                const pluginState = contentTableColumnResizingPluginKey.getState(state);
                if (pluginState && pluginState.activeHandle > -1) {
                    return handleDecorations(state, pluginState.activeHandle);
                }
            },
        },
    });
    return plugin;
}

class ContentTableColumnResizeState {
    constructor(public activeHandle: number, public dragging: Dragging | false) {}

    // Applies the transaction to update the resizing state
    apply(tr: Transaction): ContentTableColumnResizeState {
        const state = this;
        const action = tr.getMeta(contentTableColumnResizingPluginKey);
        if (action?.setHandle != null)
            return new ContentTableColumnResizeState(action.setHandle, false);
        if (action?.setDragging !== undefined)
            return new ContentTableColumnResizeState(state.activeHandle, action.setDragging);
        if (state.activeHandle > -1 && tr.docChanged) {
            let handle = tr.mapping.map(state.activeHandle, -1);
            if (!pointsAtContentTableCell(tr.doc.resolve(handle))) {
                handle = -1;
            }
            return new ContentTableColumnResizeState(handle, state.dragging);
        }
        return state;
    }
}

// Handles mouse movement to update the active column handle
function handleMouseMove(
    view: EditorView,
    event: MouseEvent,
    handleWidth: number,
    lastColumnResizable: boolean,
): void {
    const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
    if (!pluginState) return;

    if (!pluginState.dragging) {
        const target = domCellAround(event.target as HTMLElement);
        let cell = -1;
        if (target) {
            const {left, right} = target.getBoundingClientRect();
            if (event.clientX - left <= handleWidth)
                cell = edgeCell(view, event, "left", handleWidth);
            else if (right - event.clientX <= handleWidth)
                cell = edgeCell(view, event, "right", handleWidth);
        }

        if (cell != pluginState.activeHandle) {
            if (!lastColumnResizable && cell !== -1) {
                const $cell = view.state.doc.resolve(cell);
                const table = $cell.node(-1);
                const map = ContentTableMap.get(table);
                const tableStart = $cell.start(-1);
                const col = map.colCount($cell.pos - tableStart);

                if (col == map.width - 1) {
                    return;
                }
            }

            updateHandle(view, cell);
        }
    }
}

// Handles mouse leave event to reset the active handle
function handleMouseLeave(view: EditorView): void {
    const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
    if (pluginState && pluginState.activeHandle > -1 && !pluginState.dragging)
        updateHandle(view, -1);
}

// Initiates the column resizing process on mouse down
function handleMouseDown(
    view: EditorView,
    event: MouseEvent,
    cellMinWidth: number,
    defaultCellMinWidth: number,
): boolean {
    const win = view.dom.ownerDocument.defaultView ?? window;

    const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
    if (!pluginState || pluginState.activeHandle == -1 || pluginState.dragging) return false;

    const $cell = view.state.doc.resolve(pluginState.activeHandle);
    const table = $cell.node(-1);
    // NOCOMMIT: Update this
    const width = currentColWidth(view, pluginState.activeHandle, table.attrs.columnWidths);
    view.dispatch(
        view.state.tr.setMeta(contentTableColumnResizingPluginKey, {
            setDragging: {startX: event.clientX, startWidth: width},
        }),
    );

    // Finalizes the resizing process when the mouse is released
    function finish(event: MouseEvent) {
        win.removeEventListener("mouseup", finish);
        win.removeEventListener("mousemove", move);
        const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
        if (pluginState?.dragging) {
            updateColumnWidth(
                view,
                pluginState.activeHandle,
                draggedWidth(pluginState.dragging, event, cellMinWidth),
            );
            view.dispatch(
                view.state.tr.setMeta(contentTableColumnResizingPluginKey, {setDragging: null}),
            );
        }
    }

    // Updates the column width as the mouse is moved while dragging
    function move(event: MouseEvent): void {
        if (!event.which) return finish(event);
        const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
        if (!pluginState) return;
        if (pluginState.dragging) {
            const dragged = draggedWidth(pluginState.dragging, event, cellMinWidth);
            displayColumnWidth(view, pluginState.activeHandle, dragged, defaultCellMinWidth);
        }
    }

    displayColumnWidth(view, pluginState.activeHandle, width, defaultCellMinWidth);

    win.addEventListener("mouseup", finish);
    win.addEventListener("mousemove", move);
    event.preventDefault();
    return true;
}

// Calculates the current width of the specified column
function currentColWidth(view: EditorView, cellPos: number, columnWidths: Array<number>): number {
    // Get the column index for the current cell
    const $cell = view.state.doc.resolve(cellPos);
    const table = $cell.node(-1);
    const map = ContentTableMap.get(table);
    const start = $cell.start(-1);
    const col = map.colCount($cell.pos - start);

    // If we have a width for this column, return it
    if (columnWidths?.[col]) {
        return columnWidths[col] ?? 0;
    }

    // For brand new table or empty columnWidths
    //
    // NOCOMMIT: Update this? Definitely seems wrong. Delete table units
    const dom = view.domAtPos(cellPos);
    const node = dom.node.childNodes[dom.offset] as HTMLElement;
    const domWidth = node.offsetWidth;
    const remPx = getTableUnitPxWithoutListening();
    return domWidth / remPx;
}

// Finds the table cell element around the given target
function domCellAround(target: HTMLElement | null): HTMLElement | null {
    while (target && target.nodeName != "TD" && target.nodeName != "TH")
        target = target?.classList?.contains("ProseMirror")
            ? null
            : (target.parentNode as HTMLElement);
    return target;
}

// Determines the cell at the edge of the column being resized
function edgeCell(
    view: EditorView,
    event: MouseEvent,
    side: "left" | "right",
    handleWidth: number,
): number {
    // posAtCoords returns inconsistent positions when cursor is moving
    // across a collapsed table border. Use an offset to adjust the
    // target viewport coordinates away from the table border.
    const offset = side == "right" ? -handleWidth : handleWidth;
    const found = view.posAtCoords({
        left: event.clientX + offset,
        top: event.clientY,
    });
    if (!found) return -1;
    const {pos} = found;
    const $cell = contentTableCellAround(view.state.doc.resolve(pos));
    if (!$cell) return -1;
    if (side == "right") return $cell.pos;
    const map = ContentTableMap.get($cell.node(-1)),
        start = $cell.start(-1);
    const index = map.map.indexOf($cell.pos - start);
    return index % map.width == 0 ? -1 : start + map.map[index - 1]!;
}

// Calculates the new width of the column being dragged
function draggedWidth(dragging: Dragging, event: MouseEvent, resizeMinWidth: number): number {
    const remPx = getTableUnitPxWithoutListening();
    const offsetInRem = (event.clientX - dragging.startX) / remPx;
    return Math.max(resizeMinWidth, dragging.startWidth + offsetInRem);
}

// Updates the active handle for resizing
function updateHandle(view: EditorView, value: number): void {
    view.dispatch(view.state.tr.setMeta(contentTableColumnResizingPluginKey, {setHandle: value}));
}

function updateColumnWidth(view: EditorView, cell: number, width: number): void {
    const $cell = view.state.doc.resolve(cell);
    const table = $cell.node(-1),
        map = ContentTableMap.get(table),
        start = $cell.start(-1);

    const col = map.colCount($cell.pos - start);
    const tr = view.state.tr;

    // Get current columnWidths or initialize new array
    //
    // NOCOMMIT: Update this
    const columnWidths = [...(table.attrs.columnWidths || zeroes(map.width))];
    // Update the width for the specific column (width is already in rem)
    columnWidths[col] = width;

    // Update table attributes with new columnWidths
    tr.setNodeMarkup($cell.before(-1), null, {
        ...table.attrs,
        columnWidths,
    });

    if (tr.docChanged) view.dispatch(tr);
}

// Displays the width of the column being resized
function displayColumnWidth(
    view: EditorView,
    cell: number,
    finalResizedColWidth: number,
    defaultCellMinWidth: number,
): void {
    const $cell = view.state.doc.resolve(cell);
    const table = $cell.node(-1),
        start = $cell.start(-1);

    const colNumber = ContentTableMap.get(table).colCount($cell.pos - start);
    let dom: Node | null = view.domAtPos($cell.start(-1)).node;
    while (dom && dom.nodeName != "TABLE") {
        dom = dom.parentNode;
    }
    if (!dom) return;
    updateContentTableColumnsOnResize(
        table,
        dom.firstChild as HTMLTableColElement,
        dom as HTMLTableElement,
        defaultCellMinWidth,
        colNumber,
        finalResizedColWidth,
    );
}

// Creates an array of zeros for column widths
function zeroes(n: number): Array<0> {
    return Array(n).fill(0);
}

// Handles the decorations for the column resize handle
function handleDecorations(state: EditorState, cell: number): DecorationSet {
    const decorations = [];
    const $cell = state.doc.resolve(cell);
    const table = $cell.node(-1);
    if (!table) {
        return DecorationSet.empty;
    }

    const map = ContentTableMap.get(table);
    const start = $cell.start(-1);
    const col = map.colCount($cell.pos - start);
    for (let row = 0; row < map.height; row++) {
        const index = col + row * map.width;
        // For positions that have either a different cell or the end
        // of the table to their right, and either the top of the table or
        // a different cell above them, add a decoration
        if (
            (col == map.width - 1 || map.map[index] != map.map[index + 1]) &&
            (row == 0 || map.map[index] != map.map[index - map.width])
        ) {
            const cellPos = map.map[index]!;
            const pos = start + cellPos + table.nodeAt(cellPos)!.nodeSize - 1;
            const dom = document.createElement("div");
            dom.className = contentStyles.tableColumnResizeHandleClassName;
            if (contentTableColumnResizingPluginKey.getState(state)?.dragging) {
                decorations.push(
                    Decoration.node(
                        start + cellPos,
                        start + cellPos + table.nodeAt(cellPos)!.nodeSize,
                        {class: contentStyles.tableColumnResizeDraggingClassName},
                    ),
                );
            }

            decorations.push(Decoration.widget(pos, dom));
        }
    }
    return DecorationSet.create(state.doc, decorations);
}
