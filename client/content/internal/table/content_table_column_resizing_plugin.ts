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
    contentTableEditingKey,
} from "~/client/content/internal/table/content_table_client_util.js";
import {getPlatformWithoutListening} from "~/client/remix/platform_context.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {
    tableWrapper2ClassName,
    tableWrapper3ClassName,
    tableWrapperClassName,
} from "~/shared/content/content_styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {pointsAtContentTableCell} from "~/shared/content/table/content_table_shared_util.js";
import {convertRemLengthToPx, screenPaddingXRem} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
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
          readonly dragging: {
              readonly startX: number;
              readonly viewWidthPx: number;
              readonly oldTotalColumnWidthPx: number;
              readonly state: ContentTableColumnResizeDraggingState;
          } | null;
      };

type ContentTableColumnResizeDraggingState = {
    readonly tablePos: number;
    readonly oldTable: Node;
    readonly oldTableMap: ContentTableMap;
    readonly columnIndex: number;
    readonly getTableElement: (view: EditorView) => HTMLTableElement | null;
};

function getContentTableColumnResizeDraggingState(
    doc: Node,
    activeHandle: number,
): ContentTableColumnResizeDraggingState {
    const $cell = doc.resolve(activeHandle);

    let tablePos: number;
    let table: Node;
    let tableMap: ContentTableMap;
    let columnIndex: number;

    if ($cell.parent.type.name === "table") {
        tablePos = $cell.start();
        table = $cell.node();
        tableMap = ContentTableMap.get(table);
        columnIndex = -1;
    } else {
        assert($cell.parent.type.name === "tableRow");

        tablePos = $cell.start(-1);
        table = $cell.node(-1);
        tableMap = ContentTableMap.get(table);
        columnIndex = tableMap.colCount($cell.pos - tablePos);
    }

    let tableElement: HTMLTableElement | null = null;

    return {
        tablePos,
        oldTable: table,
        oldTableMap: tableMap,
        columnIndex,
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
    public readonly dragging: {
        readonly startX: number;
        readonly viewWidthPx: number;
        readonly oldTotalColumnWidthPx: number;
        readonly state: ContentTableColumnResizeDraggingState;
    } | null;

    constructor(
        activeHandle: number | null,
        dragging: {
            readonly startX: number;
            readonly viewWidthPx: number;
            readonly oldTotalColumnWidthPx: number;
            readonly state: ContentTableColumnResizeDraggingState;
        } | null,
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
                state = new ContentTableColumnResizeState(state.activeHandle, {
                    startX: state.dragging.startX,
                    viewWidthPx: state.dragging.viewWidthPx,
                    oldTotalColumnWidthPx: state.dragging.oldTotalColumnWidthPx,
                    state: getContentTableColumnResizeDraggingState(tr.doc, state.activeHandle),
                });
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
    const isDraggingSelection = contentTableEditingKey.getState(view.state) != null;
    if (isDraggingSelection) return;

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

            // This case occurs when the mouse is outside the table and approaching the
            // left edge.
            if (event.clientX <= left && left - event.clientX <= halfHandleWidth) {
                cell = getEdgeContentTableCell(view, event, "left", halfHandleWidth);
            }
            // This case occurs when the mouse is outside the table and approaching the
            // right edge.
            else if (event.clientX >= right && event.clientX - right <= halfHandleWidth) {
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

    {
        const draggingState = getContentTableColumnResizeDraggingState(
            view.state.doc,
            pluginState.activeHandle,
        );

        const tableElement = draggingState.getTableElement(view);
        if (!tableElement) return false;

        view.dispatch(
            view.state.tr.setMeta(
                contentTableColumnResizingPluginKey,
                cast<ContentTableColumnResizeAction>({
                    type: "SetDragging",
                    dragging: {
                        startX: event.clientX,
                        viewWidthPx: view.dom.offsetWidth,
                        oldTotalColumnWidthPx: tableElement.offsetWidth,
                        state: draggingState,
                    },
                }),
            ),
        );
    }
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

        const tableElement = pluginState.dragging.state.getTableElement(view);
        if (!tableElement) {
            finish(event);
            return;
        }

        const newTableAndColumnWidths = getContentTableColumnResizeDraggingStateNewColumnWidths(
            event,
            pluginState.dragging,
        );

        updateContentTableColumnsOnResize(
            pluginState.dragging.state.oldTable,
            tableElement,
            newTableAndColumnWidths,
        );
    }

    // Finalizes the resizing process when the mouse is released
    function finish(event: MouseEvent) {
        window.removeEventListener("mouseup", finish);
        window.removeEventListener("mousemove", move);
        dragCoverElement.remove();

        const pluginState = contentTableColumnResizingPluginKey.getState(view.state);
        if (!pluginState?.dragging || pluginState.activeHandle === null) return;

        const {tableWidth: newTableWidth, columnWidths: newColumnWidths} =
            getContentTableColumnResizeDraggingStateNewColumnWidths(event, pluginState.dragging);

        const transaction = view.state.tr;

        if (newTableWidth === undefined) {
            transaction.setNodeAttribute(
                pluginState.dragging.state.tablePos - 1,
                "columnWidths",
                newColumnWidths,
            );
        } else {
            transaction.setNodeMarkup(pluginState.dragging.state.tablePos - 1, null, {
                ...pluginState.dragging.state.oldTable.attrs,
                tableWidth: newTableWidth,
                columnWidths: newColumnWidths,
            });
        }

        view.dispatch(
            transaction.setMeta(
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
    if (
        target?.nodeName === "TABLE" &&
        target.parentElement?.classList.contains(tableWrapper3ClassName)
    ) {
        return target;
    }

    if (target?.classList.contains(tableWrapperClassName)) {
        for (const childNode of target.childNodes) {
            if (!(childNode instanceof HTMLElement)) continue;
            if (childNode.classList.contains(tableWrapper2ClassName)) {
                target = childNode;
            }
        }
    }

    if (target?.classList.contains(tableWrapper2ClassName)) {
        for (const childNode of target.childNodes) {
            if (!(childNode instanceof HTMLElement)) continue;
            if (childNode.classList.contains(tableWrapper3ClassName)) {
                target = childNode;
            }
        }
    }

    if (target?.classList.contains(tableWrapper3ClassName)) {
        for (const childNode of target.childNodes) {
            if (childNode.nodeName === "TABLE") {
                return childNode as HTMLElement;
            }
        }
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
    const {pos, inside} = found;
    let $pos = view.state.doc.resolve(pos);

    // If `$pos` points to a `table` instead of a `tableCell` then try using the
    // `inside` position instead. This fixes a bug where when hovering over the 1px
    // between table rows `pos` points into the table. When changing this you need
    // to test:
    //
    // 1. Hovering over the blue part of the resize handle then slowly moving down
    //    through the row border (resize handle should be visible the entire time)
    //
    // 2. Hovering over the transparent part of the resize handle then slowly
    //    moving down through the row border (resize handle should be visible the
    //    entire time)
    if ($pos.parent.type.name === "table" && inside !== -1)
        $pos = view.state.doc.resolve(inside + 1);

    const $cell = contentTableCellAround($pos);
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

/**
 * Computes the absolute pixel width of each column in a table. Implements the
 * same algorithm CSS grid will use to layout our table in the DOM.
 *
 * `totalColumnWidth` must be the sum of all `columnWidths`. Most of the time
 * you'll have precomputed this value so pass it in so we don't have to compute
 * it again.
 */
// NOTE(calebmer): Normally, since this has 4 arguments, I'd write this with a
// named argument object. But since this code will be called in a hot path
// (every frame) using positional arguments to avoid an extra object
// allocation.
export function resolveContentTableColumnWidthPx(
    totalColumnWidth: number,
    columnWidths: ReadonlyArray<number>,
    totalColumnWidthPx: number,
    columnMinWidthPx: number,
): Array<number> {
    let hasNextPass = true;
    let currentPassTotalColumnWidth = totalColumnWidth;
    let currentPassTotalColumnWidthPx = totalColumnWidthPx;
    let nextPassTotalColumnWidth: number;
    let nextPassTotalColumnWidthPx: number;

    const columnCount = columnWidths.length;
    const columnWidthPxs: Array<number | undefined> = Array(columnCount);

    while (hasNextPass) {
        hasNextPass = false;
        nextPassTotalColumnWidth = 0;
        nextPassTotalColumnWidthPx = currentPassTotalColumnWidthPx;

        for (let i = 0; i < columnCount; i++) {
            if (columnWidthPxs[i] !== undefined) continue;

            const columnWidth = columnWidths[i]!;

            const columnWidthPx =
                (columnWidth / currentPassTotalColumnWidth) * currentPassTotalColumnWidthPx;

            if (columnWidthPx < columnMinWidthPx) {
                hasNextPass = true;
                nextPassTotalColumnWidthPx -= columnMinWidthPx;
                columnWidthPxs[i] = columnMinWidthPx;
            } else {
                nextPassTotalColumnWidth += columnWidth;
            }
        }

        currentPassTotalColumnWidth = nextPassTotalColumnWidth;
        currentPassTotalColumnWidthPx = nextPassTotalColumnWidthPx;
    }

    for (let i = 0; i < columnCount; i++) {
        if (columnWidthPxs[i] !== undefined) continue;

        columnWidthPxs[i] =
            (columnWidths[i]! / currentPassTotalColumnWidth) * currentPassTotalColumnWidthPx;
    }

    return columnWidthPxs as Array<number>;
}

/**
 * Calculates the new width of the column being dragged.
 *
 * We implement the following UX principles for column resizing. These UX
 * principles should lead to a consistent, easy to understand, experience for
 * users building tables:
 *
 * 1. A column should only resize when a user drags the drag handle. It should
 *    not resize when the user types content. Instead content should wrap onto
 *    a new line as the user types.
 *
 * 2. Dragging a column drag handle should only change the size of the
 *    column(s) adjacent to the drag handle.
 *
 * 3. Dragging an interior column drag handle shouldn't change the width of the
 *    table.
 *
 * 4. Dragging an edge column drag handle (left or right) can change the width
 *    of the table.
 *
 * Some ideas for another day:
 *
 * - It's a little surprising that dragging in the middle of two min width
 *   columns does nothing. That's because of our resize principle to only
 *   change the size of columns adjacent to the drag handle. Maybe we should
 *   consider loosening principle 3. Allowing the table to resize if it already
 *   has a width greater than 1 seems fine. We want to keep tables with a width
 *   of 1 as much as possible since tables with a width of 1 won't overflow on
 *   mobile.
 *
 * - Allow columns to snap to the same width as other columns. This allows
 *   users to easily build well designed tables that have consistent spacing
 *   across multiple columns. Or add a "set width" feature that lets the user
 *   set the column width as a percent.
 */
export function getContentTableColumnResizeDraggingStateNewColumnWidths(
    event: {clientX: number},
    {
        startX,
        viewWidthPx,
        oldTotalColumnWidthPx: actualOldTotalColumnWidthPx,
        state: {
            columnIndex: column1Index,
            oldTableMap: {columnWidths: oldColumnWidths, totalColumnWidth: oldTotalColumnWidth},
        },
    }: {
        startX: number;
        viewWidthPx: number;
        oldTotalColumnWidthPx: number;
        state: {
            columnIndex: number;
            oldTableMap: {
                columnWidths: ReadonlyArray<number>;
                totalColumnWidth: number;
            };
        };
    },
): {
    tableWidth?: number;
    columnWidths: ReadonlyArray<number>;
    scrollTo?: "left" | "right";
} {
    const offsetPx = event.clientX - startX;

    const platform = getPlatformWithoutListening();
    const spacingScale = getSpacingScaleWithoutListening();
    const remPx = remPxBySpacingScale[spacingScale];
    const columnMinWidthPx = contentStyles.tableColumnMinWidthRem * remPx;
    const columnMaxWidthPx = contentStyles.tableColumnMaxWidthRem * remPx;

    const blockWidthPx = Math.min(
        viewWidthPx - screenPaddingXRem[platform] * remPx,
        contentStyles.blockMaxWidthRem[platform] * remPx,
    );

    const minTotalColumnWidthPx = Math.max(
        columnMinWidthPx * oldColumnWidths.length,
        // Don't shrink smaller than the editor's block width.
        blockWidthPx,
    );

    const maxTotalColumnWidthPx = columnMaxWidthPx * oldColumnWidths.length;

    const oldTotalColumnWidthPx = clamp(
        minTotalColumnWidthPx,
        actualOldTotalColumnWidthPx,
        maxTotalColumnWidthPx,
    );

    // There are two branches to this function:
    //
    // 1. If we're dragging a resize handle on the edge of the table
    // 2. If we're dragging a resize handle inside the table (between two columns)
    //
    // Dragging a resize handle inside the table (branch 2) is not allowed to
    // change the table's width. Only dragging a resize handle at the edge of the
    // table may resize the table width.
    //
    // While dragging a resize handle we'll only change the column widths adjacent
    // to that resize handle.
    if (column1Index < 0 || column1Index >= oldColumnWidths.length - 1) {
        const isLeftResize = column1Index < 0;
        const columnIndex = isLeftResize ? 0 : oldColumnWidths.length - 1;
        const oldColumnWidth = oldColumnWidths[columnIndex]!;
        const oldColumnWidthPx = oldTotalColumnWidthPx * (oldColumnWidth / oldTotalColumnWidth);

        let newColumnWidthPx = clamp(
            columnMinWidthPx,
            oldColumnWidthPx +
                // Double the speed at which offset grows/shrinks the column. Since when
                // centered every pixel the table grows is added half to the left and half to
                // the right.
                (isLeftResize ? -1 : 1) * offsetPx * 2,
            columnMaxWidthPx,
        );

        const expectedNewTotalColumnWidthPx =
            oldTotalColumnWidthPx - (oldColumnWidthPx - newColumnWidthPx);

        const newTotalColumnWidthPx = clamp(
            minTotalColumnWidthPx,
            expectedNewTotalColumnWidthPx,
            maxTotalColumnWidthPx,
        );

        // If the new column width violates total column width min/max bounds then we
        // need to adjust the new column width back down to what'll work with our total
        // column width min/max bounds.
        newColumnWidthPx += newTotalColumnWidthPx - expectedNewTotalColumnWidthPx;

        const newColumnWidths: Array<number | null> = [];
        let newOtherTotalColumnWidth = 0;

        // Our `oldColumnWidths` array may not accurately represent what's in the DOM
        // if some of our columns are running up against their min width. So run the
        // same calculation used by CSS grid to determine the actual column widths.
        const oldColumnWidthPxs = resolveContentTableColumnWidthPx(
            oldTotalColumnWidth,
            oldColumnWidths,
            oldTotalColumnWidthPx,
            columnMinWidthPx,
        );

        for (
            let otherColumnIndex = 0;
            otherColumnIndex < oldColumnWidths.length;
            otherColumnIndex++
        ) {
            if (otherColumnIndex === columnIndex) {
                newColumnWidths.push(null);
                continue;
            }

            const oldOtherColumnWidth =
                (oldColumnWidthPxs[otherColumnIndex]! / oldTotalColumnWidthPx) *
                oldTotalColumnWidth;

            newColumnWidths.push(oldOtherColumnWidth);
            newOtherTotalColumnWidth += oldOtherColumnWidth;
        }

        // We have the following equality:
        //
        // ```ts
        // newColumnWidthPx / newTotalColumnWidthPx ===
        //     newColumnWidth / (newColumnWidth + newOtherTotalColumnWidth)
        // ```
        //
        // All variables in the equality are known except for `newColumnWidth`.
        // We can use [algebra to solve for `newColumnWidth`][1] which gives us the
        // following equation.
        //
        // [1]: https://www.wolframalpha.com/input?i=solve+c+in+a+%2F+b+%3D+c+%2F+%28c+%2B+d%29
        const newColumnWidth = -(
            (newColumnWidthPx * newOtherTotalColumnWidth) /
            (newColumnWidthPx - newTotalColumnWidthPx)
        );

        newColumnWidths[columnIndex] = newColumnWidth;

        // Compute the old table width on the fly since the `tableWidth` attr in
        // ProseMirror may not accurately reflect what's in the DOM.
        const oldTableWidth = Math.max(1, oldTotalColumnWidthPx / blockWidthPx);

        const newTableWidth = Math.max(
            1,
            oldTableWidth * (newTotalColumnWidthPx / oldTotalColumnWidthPx),
        );

        return {
            tableWidth: newTableWidth,
            columnWidths: newColumnWidths as Array<number>,
            scrollTo: isLeftResize ? "left" : "right",
        };
    } else if (oldColumnWidths.length <= 3) {
        // if the number of columns are less than equal to 3 then make sure the
        // interior column resizer is affecting both the column width and not the
        // table width
        const column2Index = column1Index + 1;
        const oldColumn2Width = oldColumnWidths[column2Index]!;

        const oldColumn1Width = oldColumnWidths[column1Index]!;
        const oldColumn1WidthPx = oldTotalColumnWidthPx * (oldColumn1Width / oldTotalColumnWidth);

        // Make sure the new column 1 width is in our min/max bounds.
        const newColumn1WidthPx = clamp(
            columnMinWidthPx,
            oldColumn1WidthPx + offsetPx,
            columnMaxWidthPx,
        );
        let newColumn1Width = (newColumn1WidthPx / oldTotalColumnWidthPx) * oldTotalColumnWidth;
        let newColumn2Width = oldColumn1Width + oldColumn2Width - newColumn1Width;
        let newColumn2WidthPx = (newColumn2Width / oldTotalColumnWidth) * oldTotalColumnWidthPx;

        // Make sure the new column 2 width is in our min/max bounds.
        if (newColumn2WidthPx < columnMinWidthPx) {
            newColumn2WidthPx = columnMinWidthPx;
            newColumn2Width = (newColumn2WidthPx / oldTotalColumnWidthPx) * oldTotalColumnWidth;
            newColumn1Width = oldColumn1Width + oldColumn2Width - newColumn2Width;
        } else if (newColumn2WidthPx > columnMaxWidthPx) {
            newColumn2WidthPx = columnMaxWidthPx;
            newColumn2Width = (newColumn2WidthPx / oldTotalColumnWidthPx) * oldTotalColumnWidth;
            newColumn1Width = oldColumn1Width + oldColumn2Width - newColumn2Width;
        }

        const newColumnWidths: Array<number> = [];

        for (let columnIndex = 0; columnIndex < oldColumnWidths.length; columnIndex++) {
            if (columnIndex === column1Index) newColumnWidths.push(newColumn1Width);
            else if (columnIndex === column2Index) newColumnWidths.push(newColumn2Width);
            else newColumnWidths.push(oldColumnWidths[columnIndex]!);
        }

        return {
            columnWidths: newColumnWidths,
        };
    } else {
        const oldColumnWidthPxs = resolveContentTableColumnWidthPx(
            oldTotalColumnWidth,
            oldColumnWidths,
            oldTotalColumnWidthPx,
            columnMinWidthPx,
        );

        const oldColumn1WidthPx = oldColumnWidthPxs[column1Index]!;

        // Calculate new width based on drag offset
        const newColumn1WidthPx = clamp(
            columnMinWidthPx,
            oldColumn1WidthPx + offsetPx,
            columnMaxWidthPx,
        );
        // Calculate how much the table needs to grow/shrink
        const widthDifference = newColumn1WidthPx - oldColumn1WidthPx;
        const expectedNewTotalColumnWidthPx = oldTotalColumnWidthPx + widthDifference;
        const newTotalColumnWidthPx = clamp(
            minTotalColumnWidthPx,
            expectedNewTotalColumnWidthPx,
            maxTotalColumnWidthPx,
        );

        // Calculate new relative width for the resized column:
        //
        // We have the following equality, where `newTotalColumnWidth` is the new
        // total column width and it is being calculated from the old total column
        // width, the old width of the column being resized, and the new width of
        // the column being resized:
        //
        // ```ts
        // newTotalColumnWidth = oldTotalColumnWidth - oldColumn1Width + newColumn1Width
        // ```
        //
        // We also have the following equality, where `newColumn1Width` is the new
        // width of the column being resized: Here we are comparing the ratio of
        // the relatives values to the ratio of the pixels values.
        //
        // ```ts
        // newColumn1Width / newTotalColumnWidth = newColumn1WidthPx / newTotalColumnWidthPx
        // ```
        //
        // If we simplify this using 1st equality we get:
        //
        // ```ts
        // newColumn1Width / (oldTotalColumnWidth - oldColumnWidth + newColumn1Width) = newColumnWidth1Px / newTotalColumnWidthPx
        // ```
        //
        // which can be written as: a / (b - c + a) = d / f
        //
        // All variables in the equality are known except for `newColumn1Width`.
        // We can use [algebra to solve for `newColumn1Width`][1] which gives us the
        // following equation.
        //
        // [1]: https://www.wolframalpha.com/input?i=solve+for+a++a+%2F+%28b+-+c+%2B+a%29+%3D+d+%2F+f
        const newColumn1Width =
            (newColumn1WidthPx * (oldTotalColumnWidth - oldTotalColumnWidthPx)) /
            (newColumn1WidthPx - newTotalColumnWidthPx);

        // Keep other columns unchanged
        const newColumnWidths: Array<number> = [...oldColumnWidths];
        newColumnWidths[column1Index] = newColumn1Width;

        // Update table width
        const oldTableWidth = Math.max(1, oldTotalColumnWidthPx / blockWidthPx);
        const newTableWidth = Math.max(
            1,
            oldTableWidth * (newTotalColumnWidthPx / oldTotalColumnWidthPx),
        );

        return {
            tableWidth: newTableWidth,
            columnWidths: newColumnWidths,
        };
    }
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
            dom.className =
                columnIndex === tableMap.width - 1
                    ? `${contentStyles.tableColumnResizeHandleClassName} ${contentStyles.tableRightEdgeColumnResizeHandleClassName}`
                    : contentStyles.tableColumnResizeHandleClassName;
            decorations.push(Decoration.widget(pos, dom));
        }

        return DecorationSet.create(state.doc, decorations);
    }
}
