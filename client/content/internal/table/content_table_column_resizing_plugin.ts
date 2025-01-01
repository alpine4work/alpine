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
import {
    contentTableCellAround,
    getContentTableColumnWidths,
} from "~/client/content/internal/table/content_table_client_util.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {pointsAtContentTableCell} from "~/shared/content/table/content_table_shared_util.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";

export const contentTableColumnResizingPluginKey = new PluginKey<ContentTableColumnResizeState>(
    "contentTableColumnResizing",
);


type Dragging = {startX: number; startColumnWidth: number};

// The contentTableColumnResizingPlugin sets up event handlers for mouse events
// related to column resizing. When the user clicks and drags on a column border,
// the handleMouseDown function is called, which initiates the column resizing
// process. As the user drags the mouse, the move function is called repeatedly,
// updating the column width based on the mouse position. When the user releases
// the mouse button, the finish function is called, which commits the column
// width changes.
export function contentTableColumnResizingPlugin(): Plugin {
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
            handleDOMEvents: {
                // Handles mouse movement to update the active column handle
                mousemove: (view, event) => {
                    handleMouseMove(view, event);
                },
                // Handles mouse leave event to reset the active handle
                mouseleave: view => {
                    handleMouseLeave(view);
                },
                // Initiates the column resizing process on mouse down
                mousedown: (view, event) => {
                    handleMouseDown(view, event);
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
function handleMouseMove(view: EditorView, event: MouseEvent): void {
    const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
    if (!pluginState) return;

    if (!pluginState.dragging) {
        const spacingScale = getSpacingScaleWithoutListening();
        const halfHandleWidth =
            Math.floor(
                convertRemLengthToPx(contentStyles.tableColumnResizeHandleWidth, spacingScale) / 2,
            ) -
            // Subtract 1px to avoid subpixel rendering edge cases where we think we're
            // hovering over the resize handle but the DOM element doesn't actually cover
            // the pixel.
            1;

        const target = domCellAround(event.target as HTMLElement);
        let cell = -1;
        if (target) {
            const {left, right} = target.getBoundingClientRect();
            if (event.clientX - left <= halfHandleWidth)
                cell = edgeCell(view, event, "left", halfHandleWidth);
            else if (right - event.clientX <= halfHandleWidth)
                cell = edgeCell(view, event, "right", halfHandleWidth);
        }

        if (cell != pluginState.activeHandle) {
            // NOCOMMIT: Understand this code path. Also add drag handle at the start?
            if (!true && cell !== -1) {
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
function handleMouseDown(view: EditorView, event: MouseEvent): boolean {
    const win = view.dom.ownerDocument.defaultView ?? window;

    let pluginState = contentTableColumnResizingPluginKey.getState(view.state);
    if (!pluginState || pluginState.activeHandle === -1 || pluginState.dragging) return false;

    const getData = () => {
        if (!pluginState || pluginState.activeHandle === -1) return null;

        const $activeHandle = view.state.doc.resolve(pluginState.activeHandle);
        const tablePos = $activeHandle.start(-1);
        const table = $activeHandle.node(-1);
        const tableMap = ContentTableMap.get(table);
        const columnWidths = getContentTableColumnWidths(table);
        const totalColumnWidth = columnWidths.reduce(
            (totalColumnWidth, columnWidth) => totalColumnWidth + columnWidth,
            0,
        );
        const columnIndex = tableMap.colCount($activeHandle.pos - tablePos);
        const columnWidth = columnWidths[columnIndex]!;

        let tableElement: HTMLTableElement | null = null;
        {
            let element: globalThis.Node | null = view.domAtPos(tablePos).node;
            while (element && element.nodeName != "TABLE") element = element.parentNode;

            tableElement = element as HTMLTableElement | null;
        }

        if (!tableElement) return null;

        return {
            $activeHandle,
            tablePos,
            table,
            tableMap,
            columnWidths,
            totalColumnWidth,
            columnIndex,
            columnWidth,
            tableElement,
        };
    };

    let lastDoc = view.state.doc;
    let lastActiveHandle = pluginState.activeHandle;
    let data = getData();
    if (!data) return false;

    view.dispatch(
        view.state.tr.setMeta(contentTableColumnResizingPluginKey, {
            setDragging: {startX: event.clientX, startColumnWidth: data.columnWidth},
        }),
    );

    // Updates the column width as the mouse is moved while dragging
    function move(event: MouseEvent): void {
        if (!event.which) {
            finish(event);
            return;
        }

        pluginState = contentTableColumnResizingPluginKey.getState(view.state);
        if (!pluginState?.dragging || pluginState.activeHandle === -1) {
            finish(event);
            return;
        }

        // Optimization: Instead of constantly recalculating variables like
        // `columnWidths` and `tableElement` we only recalculate them if the document
        // changed.
        if (lastDoc !== view.state.doc || lastActiveHandle !== pluginState.activeHandle) {
            lastDoc = view.state.doc;
            lastActiveHandle = pluginState.activeHandle;
            data = getData();
        }

        if (!data) {
            finish(event);
            return;
        }

        const newColumnWidths = getDraggingColumnWidths(pluginState.dragging, event, data);

        updateContentTableColumnsOnResize(
            data.table,
            data.tableElement.firstChild as HTMLTableColElement,
            newColumnWidths,
        );
    }

    // Finalizes the resizing process when the mouse is released
    function finish(event: MouseEvent) {
        win.removeEventListener("mouseup", finish);
        win.removeEventListener("mousemove", move);
        dragCoverElement.remove();

        pluginState = contentTableColumnResizingPluginKey.getState(view.state);
        if (!pluginState?.dragging || pluginState.activeHandle === -1) return;

        // Optimization: Instead of constantly recalculating variables like
        // `columnWidths` and `tableElement` we only recalculate them if the document
        // changed.
        if (lastDoc !== view.state.doc || lastActiveHandle !== pluginState.activeHandle) {
            lastDoc = view.state.doc;
            lastActiveHandle = pluginState.activeHandle;
            data = getData();
        }

        if (!data) return;

        const newColumnWidths = getDraggingColumnWidths(pluginState.dragging, event, data);

        view.dispatch(
            view.state.tr
                .setNodeAttribute(data.tablePos - 1, "columnWidths", newColumnWidths)
                .setMeta(contentTableColumnResizingPluginKey, {setDragging: null}),
        );
    }

    updateContentTableColumnsOnResize(
        data.table,
        data.tableElement.firstChild as HTMLTableColElement,
        data.columnWidths,
    );

    // Block the DOM with a cover element so we don't trigger hover effects and the
    // cursor always stays the same.
    const dragCoverElement = document.createElement("div");

    dragCoverElement.className = sprinkles({
        position: "absolute",
        inset: "0",
        zIndex: "70",
        cursor: "col-resize",
    });

    document.body.appendChild(dragCoverElement);

    win.addEventListener("mouseup", finish);
    win.addEventListener("mousemove", move);
    event.preventDefault();
    return true;
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
    const {pos, inside} = found;
    // When hovering over the 1px border between rows, `pos` will point to a
    // position in the `table` node whereas `inside` consistently points to a
    // position between cells. Which is why we prefer `inside` when available.
    const $cell = contentTableCellAround(view.state.doc.resolve(inside !== -1 ? inside + 1 : pos));
    if (!$cell) return -1;
    if (side == "right") return $cell.pos;
    const map = ContentTableMap.get($cell.node(-1)),
        start = $cell.start(-1);
    const index = map.map.indexOf($cell.pos - start);
    return index % map.width == 0 ? -1 : start + map.map[index - 1]!;
}

// Calculates the new width of the column being dragged
function getDraggingColumnWidths(
    dragging: Dragging,
    event: MouseEvent,
    {
        columnWidths,
        columnIndex: column1Index,
        columnWidth: column1Width,
        totalColumnWidth,
        tableElement,
    }: {
        columnWidths: ReadonlyArray<number>;
        columnIndex: number;
        columnWidth: number;
        totalColumnWidth: number;
        tableElement: HTMLTableElement;
    },
): ReadonlyArray<number> {
    // We need to select the next column as well, so noop if `columnIndex` is the
    // last index.
    if (!(0 <= column1Index && column1Index <= columnWidths.length - 2)) return columnWidths;

    const column2Index = column1Index + 1;
    const column2Width = columnWidths[column2Index]!;

    const offsetPx = event.clientX - dragging.startX;

    const totalColumnWidthPx = tableElement.offsetWidth;
    const column1WidthPx = totalColumnWidthPx * (column1Width / totalColumnWidth);

    // NOCOMMIT: min/max width?
    // NOCOMMIT: Hold shift to change width in increments
    const newColumn1Width = ((column1WidthPx + offsetPx) / totalColumnWidthPx) * totalColumnWidth;
    const newColumn2Width = column1Width + column2Width - newColumn1Width;

    const newColumnWidths: Array<number> = [];

    for (let columnIndex = 0; columnIndex < columnWidths.length; columnIndex++) {
        if (columnIndex === column1Index) newColumnWidths.push(newColumn1Width);
        else if (columnIndex === column2Index) newColumnWidths.push(newColumn2Width);
        else newColumnWidths.push(columnWidths[columnIndex]!);
    }

    return newColumnWidths;
}

// Updates the active handle for resizing
function updateHandle(view: EditorView, value: number): void {
    view.dispatch(view.state.tr.setMeta(contentTableColumnResizingPluginKey, {setHandle: value}));
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
