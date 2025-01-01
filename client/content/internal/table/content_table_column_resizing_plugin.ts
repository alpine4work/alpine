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

import {Node} from "prosemirror-model";
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
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

export const contentTableColumnResizingPluginKey = new PluginKey<ContentTableColumnResizeState>(
    "contentTableColumnResizing",
);

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
                return new ContentTableColumnResizeState(null, null);
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
                if (pluginState && pluginState.activeHandle !== null) {
                    return handleDecorations(state, pluginState.activeHandle);
                }
            },
        },
    });
    return plugin;
}

type ContentTableColumnResizeAction =
    | {
          readonly type: "SetHandle";
          readonly handle: number | null;
      }
    | {
          readonly type: "SetDragging";
          readonly dragging: ContentTableColumnResizeDraggingState | null;
      };

type ContentTableColumnResizeDraggingState = {
    readonly startX: number;
    readonly tablePos: number;
    readonly oldTable: Node;
    readonly columnIndex: number;
    readonly oldColumnWidth: number;
    readonly oldColumnWidths: ReadonlyArray<number>;
    readonly oldTotalColumnWidth: number;
    readonly getTableElement: (view: EditorView) => HTMLTableElement | null;
};

function getContentTableColumnResizeDraggingState(
    startX: number,
    doc: Node,
    activeHandle: number,
): ContentTableColumnResizeDraggingState {
    const $activeHandle = doc.resolve(activeHandle);
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

    return {
        startX,
        tablePos,
        oldTable: table,
        columnIndex,
        oldColumnWidth: columnWidth,
        oldColumnWidths: columnWidths,
        oldTotalColumnWidth: totalColumnWidth,
        getTableElement: (view: EditorView) => {
            if (tableElement === null) {
                let element: globalThis.Node | null = view.domAtPos(tablePos).node;
                while (element && element.nodeName != "TABLE") element = element.parentNode;

                tableElement = element as HTMLTableElement | null;
            }

            return tableElement;
        },
    };
}

class ContentTableColumnResizeState {
    public readonly activeHandle: number | null;
    public readonly dragging: ContentTableColumnResizeDraggingState | null;

    constructor(
        activeHandle: number | null,
        dragging: ContentTableColumnResizeDraggingState | null,
    ) {
        this.activeHandle = activeHandle;
        this.dragging = dragging;
    }

    // Applies the transaction to update the resizing state
    apply(tr: Transaction): ContentTableColumnResizeState {
        let state: ContentTableColumnResizeState = this;

        // Update active handle position when the doc changes.
        if (state.activeHandle !== null && tr.docChanged) {
            let handle: number | null = tr.mapping.map(state.activeHandle, -1);
            if (!pointsAtContentTableCell(tr.doc.resolve(handle))) {
                handle = null;
            }
            state = new ContentTableColumnResizeState(handle, state.dragging);
        }

        // Update dragging state when the doc changes.
        if (state.dragging !== null) {
            if (state.activeHandle === null) {
                state = new ContentTableColumnResizeState(state.activeHandle, null);
            } else if (tr.docChanged) {
                state = new ContentTableColumnResizeState(
                    state.activeHandle,
                    getContentTableColumnResizeDraggingState(
                        state.dragging.startX,
                        tr.doc,
                        state.activeHandle,
                    ),
                );
            }
        }

        const action: ContentTableColumnResizeAction | undefined = tr.getMeta(
            contentTableColumnResizingPluginKey,
        );

        if (action) {
            switch (action.type) {
                case "SetHandle":
                    return new ContentTableColumnResizeState(action.handle, null);
                case "SetDragging":
                    return new ContentTableColumnResizeState(state.activeHandle, action.dragging);
                default:
                    throw exhaustive(action);
            }
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
        let cell: number | null = null;
        if (target) {
            const {left, right} = target.getBoundingClientRect();
            if (event.clientX - left <= halfHandleWidth)
                cell = edgeCell(view, event, "left", halfHandleWidth);
            else if (right - event.clientX <= halfHandleWidth)
                cell = edgeCell(view, event, "right", halfHandleWidth);
        }

        if (cell != pluginState.activeHandle) {
            // NOCOMMIT: Understand this code path. Also add drag handle at the start?
            if (!true && cell !== null) {
                const $cell = view.state.doc.resolve(cell);
                const table = $cell.node(-1);
                const map = ContentTableMap.get(table);
                const tableStart = $cell.start(-1);
                const col = map.colCount($cell.pos - tableStart);

                if (col == map.width - 1) {
                    return;
                }
            }

            view.dispatch(
                view.state.tr.setMeta(
                    contentTableColumnResizingPluginKey,
                    cast<ContentTableColumnResizeAction>({
                        type: "SetHandle",
                        handle: cell,
                    }),
                ),
            );
        }
    }
}

// Handles mouse leave event to reset the active handle
function handleMouseLeave(view: EditorView): void {
    const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
    if (pluginState && pluginState.activeHandle !== null && !pluginState.dragging) {
        view.dispatch(
            view.state.tr.setMeta(
                contentTableColumnResizingPluginKey,
                cast<ContentTableColumnResizeAction>({
                    type: "SetHandle",
                    handle: null,
                }),
            ),
        );
    }
}

// Initiates the column resizing process on mouse down
function handleMouseDown(view: EditorView, event: MouseEvent): boolean {
    const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
    if (!pluginState || pluginState.activeHandle === null || pluginState.dragging) return false;

    view.dispatch(
        view.state.tr.setMeta(
            contentTableColumnResizingPluginKey,
            cast<ContentTableColumnResizeAction>({
                type: "SetDragging",
                dragging: getContentTableColumnResizeDraggingState(
                    event.clientX,
                    view.state.doc,
                    pluginState.activeHandle,
                ),
            }),
        ),
    );

    // Updates the column width as the mouse is moved while dragging
    function move(event: MouseEvent): void {
        if (!event.which) {
            finish(event);
            return;
        }

        const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
        if (!pluginState?.dragging || pluginState.activeHandle === null) {
            finish(event);
            return;
        }

        const tableElement = pluginState.dragging.getTableElement(view);
        if (!tableElement) {
            finish(event);
            return;
        }

        const newColumnWidths = getContentTableColumnResizeDraggingStateNewColumnWidths(
            view,
            event,
            pluginState.dragging,
        );

        updateContentTableColumnsOnResize(
            pluginState.dragging.oldTable,
            tableElement.firstChild as HTMLTableColElement,
            newColumnWidths,
        );
    }

    // Finalizes the resizing process when the mouse is released
    function finish(event: MouseEvent) {
        window.removeEventListener("mouseup", finish);
        window.removeEventListener("mousemove", move);
        dragCoverElement.remove();

        const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
        if (!pluginState?.dragging || pluginState.activeHandle === null) return;

        const newColumnWidths = getContentTableColumnResizeDraggingStateNewColumnWidths(
            view,
            event,
            pluginState.dragging,
        );

        view.dispatch(
            view.state.tr
                .setNodeAttribute(
                    pluginState.dragging.tablePos - 1,
                    "columnWidths",
                    newColumnWidths,
                )
                .setMeta(
                    contentTableColumnResizingPluginKey,
                    cast<ContentTableColumnResizeAction>({
                        type: "SetDragging",
                        dragging: null,
                    }),
                ),
        );
    }

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

    window.addEventListener("mouseup", finish);
    window.addEventListener("mousemove", move);
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
): number | null {
    // posAtCoords returns inconsistent positions when cursor is moving
    // across a collapsed table border. Use an offset to adjust the
    // target viewport coordinates away from the table border.
    const offset = side == "right" ? -handleWidth : handleWidth;
    const found = view.posAtCoords({
        left: event.clientX + offset,
        top: event.clientY,
    });
    if (!found) return null;
    const {pos, inside} = found;
    // When hovering over the 1px border between rows, `pos` will point to a
    // position in the `table` node whereas `inside` consistently points to a
    // position between cells. Which is why we prefer `inside` when available.
    const $cell = contentTableCellAround(view.state.doc.resolve(inside !== -1 ? inside + 1 : pos));
    if (!$cell) return null;
    if (side == "right") return $cell.pos;
    const map = ContentTableMap.get($cell.node(-1));
    const start = $cell.start(-1);
    const index = map.map.indexOf($cell.pos - start);
    return index % map.width == 0 ? null : start + map.map[index - 1]!;
}

// Calculates the new width of the column being dragged
function getContentTableColumnResizeDraggingStateNewColumnWidths(
    view: EditorView,
    event: MouseEvent,
    {
        startX,
        columnIndex: column1Index,
        oldColumnWidth: oldColumn1Width,
        oldColumnWidths,
        // Total column width shouldn't change during the drag.
        oldTotalColumnWidth: totalColumnWidth,
        getTableElement,
    }: ContentTableColumnResizeDraggingState,
): ReadonlyArray<number> {
    const tableElement = getTableElement(view);
    if (!tableElement) return oldColumnWidths;

    // We need to select the next column as well, so noop if `columnIndex` is the
    // last index.
    if (!(0 <= column1Index && column1Index <= oldColumnWidths.length - 2)) return oldColumnWidths;

    const column2Index = column1Index + 1;
    const oldColumn2Width = oldColumnWidths[column2Index]!;

    const offsetPx = event.clientX - startX;

    const totalColumnWidthPx = tableElement.offsetWidth;
    const oldColumn1WidthPx = totalColumnWidthPx * (oldColumn1Width / totalColumnWidth);

    const spacingScale = getSpacingScaleWithoutListening();
    const columnMinWidthPx = convertRemLengthToPx(contentStyles.tableColumnMinWidth, spacingScale);
    const columnMaxWidthPx = convertRemLengthToPx(contentStyles.tableColumnMaxWidth, spacingScale);

    // Make sure the new column 1 width is in our min/max bounds.
    let newColumn1WidthPx = clamp(columnMinWidthPx, oldColumn1WidthPx + offsetPx, columnMaxWidthPx);
    let newColumn1Width = (newColumn1WidthPx / totalColumnWidthPx) * totalColumnWidth;
    let newColumn2Width = oldColumn1Width + oldColumn2Width - newColumn1Width;
    let newColumn2WidthPx = (newColumn2Width / totalColumnWidth) * totalColumnWidthPx;

    // Make sure the new column 2 width is in our min/max bounds.
    if (newColumn2WidthPx < columnMinWidthPx) {
        newColumn2WidthPx = columnMinWidthPx;
        newColumn2Width = (newColumn2WidthPx / totalColumnWidthPx) * totalColumnWidth;
        newColumn1Width = oldColumn1Width + oldColumn2Width - newColumn2Width;
        newColumn1WidthPx = (newColumn1Width / totalColumnWidth) * totalColumnWidthPx;
    } else if (newColumn2WidthPx > columnMaxWidthPx) {
        newColumn2WidthPx = columnMaxWidthPx;
        newColumn2Width = (newColumn2WidthPx / totalColumnWidthPx) * totalColumnWidth;
        newColumn1Width = oldColumn1Width + oldColumn2Width - newColumn2Width;
        newColumn1WidthPx = (newColumn1Width / totalColumnWidth) * totalColumnWidthPx;
    }

    const newColumnWidths: Array<number> = [];

    for (let columnIndex = 0; columnIndex < oldColumnWidths.length; columnIndex++) {
        if (columnIndex === column1Index) newColumnWidths.push(newColumn1Width);
        else if (columnIndex === column2Index) newColumnWidths.push(newColumn2Width);
        else newColumnWidths.push(oldColumnWidths[columnIndex]!);
    }

    console.log(newColumnWidths);

    return newColumnWidths;
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
