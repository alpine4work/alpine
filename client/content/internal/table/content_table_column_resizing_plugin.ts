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
import {tableWrapperClassName} from "~/shared/content/content_styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {pointsAtContentTableCell} from "~/shared/content/table/content_table_shared_util.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
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
                    return handleContentTableColumnResizeStateDecorations(
                        state,
                        pluginState.activeHandle,
                    );
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
    readonly oldColumnWidths: ReadonlyArray<number>;
    readonly oldTotalColumnWidth: number;
    readonly getTableElement: (view: EditorView) => HTMLTableElement | null;
};

function getContentTableColumnResizeDraggingState(
    startX: number,
    doc: Node,
    activeHandle: number,
): ContentTableColumnResizeDraggingState {
    const $cell = doc.resolve(activeHandle);

    let tablePos: number;
    let table: Node;
    let columnIndex: number;

    if ($cell.parent.type.name === "table") {
        tablePos = $cell.start();
        table = $cell.node();
        columnIndex = -1;
    } else {
        assert($cell.parent.type.name === "tableRow");

        tablePos = $cell.start(-1);
        table = $cell.node(-1);
        columnIndex = ContentTableMap.get(table).colCount($cell.pos - tablePos);
    }

    const columnWidths = getContentTableColumnWidths(table);
    const totalColumnWidth = columnWidths.reduce(
        (totalColumnWidth, columnWidth) => totalColumnWidth + columnWidth,
        0,
    );

    let tableElement: HTMLTableElement | null = null;

    return {
        startX,
        tablePos,
        oldTable: table,
        columnIndex,
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
    if (pluginState.dragging) return;

    const spacingScale = getSpacingScaleWithoutListening();
    const halfHandleWidth =
        Math.floor(
            convertRemLengthToPx(contentStyles.tableColumnResizeHandleWidth, spacingScale) / 2,
        ) -
        // Subtract 1px to avoid subpixel rendering edge cases where we think we're
        // hovering over the resize handle but the DOM element doesn't actually cover
        // the pixel.
        1;

    const target = getContentTableCellElementAround(event.target as HTMLElement);
    let cell: number | null = null;
    if (target) {
        const {left, right} = target.getBoundingClientRect();
        if (event.clientX - left <= halfHandleWidth) {
            cell = getEdgeContentTableCell(view, event, "left", halfHandleWidth);
        } else if (right - event.clientX <= halfHandleWidth) {
            cell = getEdgeContentTableCell(view, event, "right", halfHandleWidth);
        }
    } else {
        const tableTarget = getContentTableElementAround(event.target as HTMLElement);
        if (tableTarget) {
            const {left, right} = tableTarget.getBoundingClientRect();

            // This case occurs when the mouse is hovering over the 1px gap between rows.
            // Since we're not hovering over any `<td>` element in that position.
            if (left < event.clientX && event.clientX < right) {
                // We don't need to do anything here since if you hover over a `<td>` (showing
                // the column resize handle) then move your mouse to the 1px row gap we'll
                // still detect your mouse as over the resize handle decoration element which
                // extends into the row gap space.
            }
            // This case occurs when the mouse is outside the table and approaching the
            // left edge.
            else if (left - event.clientX <= halfHandleWidth) {
                cell = getEdgeContentTableCell(view, event, "left", halfHandleWidth);
            }
            // This case occurs when the mouse is outside the table and approaching the
            // right edge.
            else if (event.clientX - right <= halfHandleWidth) {
                cell = getEdgeContentTableCell(view, event, "right", halfHandleWidth);
            }
        }
    }

    if (cell !== pluginState.activeHandle) {
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
            tableElement,
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

    // Unfocus the content editor while resizing a column. So the browser cursor
    // and pointer toolbar don't render.
    view.dom.blur();

    return true;
}

// Finds the table cell element around the given target
function getContentTableCellElementAround(target: HTMLElement | null): HTMLElement | null {
    while (target && target.nodeName != "TD" && target.nodeName != "TH")
        target = target?.classList?.contains("ProseMirror")
            ? null
            : (target.parentNode as HTMLElement);
    return target;
}

// Finds the table element around the given target
function getContentTableElementAround(target: HTMLElement | null): HTMLElement | null {
    if (target?.classList.contains(tableWrapperClassName)) {
        for (const childNode of target.childNodes) {
            if (childNode.nodeName === "TABLE") {
                return childNode as HTMLElement;
            }
        }
        return null;
    }

    if (
        target?.nodeName === "TABLE" &&
        target.parentElement?.classList.contains(tableWrapperClassName)
    ) {
        return target;
    }

    return null;
}

// Determines the cell at the edge of the column being resized
function getEdgeContentTableCell(
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
    const {pos} = found;
    const $cell = contentTableCellAround(view.state.doc.resolve(pos));
    if (!$cell) return null;
    if (side == "right") return $cell.pos;
    const map = ContentTableMap.get($cell.node(-1));
    const start = $cell.start(-1);
    const index = map.map.indexOf($cell.pos - start);
    if (index % map.width !== 0) {
        return start + map.map[index - 1]!;
    } else {
        return start + map.map[index]! - 1;
    }
}

// Calculates the new width of the column being dragged
function getContentTableColumnResizeDraggingStateNewColumnWidths(
    view: EditorView,
    event: MouseEvent,
    {
        startX,
        columnIndex: column1Index,
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

    const oldColumn1Width = oldColumnWidths[column1Index]!;
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
function handleContentTableColumnResizeStateDecorations(
    state: EditorState,
    cell: number,
): DecorationSet {
    const decorations = [];
    const $cell = state.doc.resolve(cell);

    if ($cell.parent.type.name === "table") {
        const table = $cell.parent;
        const tableMap = ContentTableMap.get(table);
        const start = $cell.start();

        for (let rowIndex = 0; rowIndex < tableMap.height; rowIndex++) {
            const index = rowIndex * tableMap.width;
            const cellPos = tableMap.map[index]!;
            const pos = start + cellPos + table.nodeAt(cellPos)!.nodeSize - 1;
            const dom = document.createElement("div");
            dom.className = `${contentStyles.tableColumnResizeHandleClassName} ${contentStyles.tableLeftEdgeColumnResizeHandleClassName}`;
            decorations.push(Decoration.widget(pos, dom));
        }

        return DecorationSet.create(state.doc, decorations);
    } else {
        assert($cell.parent.type.name === "tableRow");

        const table = $cell.node(-1);
        if (!table) {
            return DecorationSet.empty;
        }

        const tableMap = ContentTableMap.get(table);
        const start = $cell.start(-1);
        const columnIndex = tableMap.colCount($cell.pos - start);

        for (let rowIndex = 0; rowIndex < tableMap.height; rowIndex++) {
            const index = columnIndex + rowIndex * tableMap.width;
            const cellPos = tableMap.map[index]!;
            const pos = start + cellPos + table.nodeAt(cellPos)!.nodeSize - 1;
            const dom = document.createElement("div");
            dom.className = contentStyles.tableColumnResizeHandleClassName;
            decorations.push(Decoration.widget(pos, dom));
        }

        return DecorationSet.create(state.doc, decorations);
    }
}
