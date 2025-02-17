import {EditorView} from "prosemirror-view";
import {selectionContentTableCell} from "~/client/content/internal/table/content_table_client_util.js";
import {contentTableColumnDragPluginKey} from "~/client/content/internal/table/content_table_column_drag_plugin.js";
import {contentTableRowDragPluginKey} from "~/client/content/internal/table/content_table_row_drag_plugin.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

export type TableDirection = "row" | "column";
export enum DraggableType {
    TABLE_ROW = "table-row",
    TABLE_COLUMN = "table-column",
}
export type Edge = "top" | "bottom" | "left" | "right";

export interface DraggableData {
    /** The index of the column where the drag started */
    sourceIndex: number;

    /** The type of element being dragged (in our case, always "table-column") */
    targetType: DraggableType;

    /** The index where the dragged column would be dropped */
    targetIndex: number;

    /**
     * The actual index where the column will be inserted, accounting for the drop position.
     * If dropping on the right edge of a column, this will be targetIndex + 1
     */
    targetAdjustedIndex: number;

    /**
     * Which edge of the target column the drag is closest to.
     * Used to determine if we should insert before or after the target column
     *
     *
     * This affects where the column will be inserted:
     *
     * If closestEdge is "left": The dragged column will be inserted BEFORE the target column
     * If closestEdge is "right": The dragged column will be inserted AFTER the target column
     */
    targetClosestEdge: Edge;

    /**
     * The overall direction of the drag movement:
     * -1: Moving column to an earlier position (left)
     *  0: No movement (dropping at same position)
     *  1: Moving column to a later position (right)
     */
    // direction: 1 | -1 | 0;
}

export const getDraggableDataFromEvent = (
    event: MouseEvent,
    view: EditorView,
    draggableType: DraggableType,
): DraggableData | undefined => {
    const $cell = selectionContentTableCell(view.state);
    assert($cell);

    const table = $cell.node(-1);
    const map = ContentTableMap.get(table);
    const tablePos = $cell.start(-1);

    let tableElement: HTMLTableElement | null = null;
    {
        let element: globalThis.Node | null = view.domAtPos(tablePos).node;
        while (element && element.nodeName != "TABLE") element = element.parentNode;

        tableElement = element as HTMLTableElement | null;
    }
    assert(tableElement instanceof HTMLTableElement);

    const tableRect = tableElement.getBoundingClientRect();

    if (draggableType === DraggableType.TABLE_COLUMN) {
        // Logic for getting the target index and closest edge based on the mouse position
        // For columnWidths [1, 2, 1]:
        // and your mouse cursor at 0.6
        //
        // [      1      |        2     *     |      1      ]         <- Column widths
        // 0           0.25      0.5   0.6   0.75          1.0        <- Cumulative positions

        // If mouse is at 0.6:
        // - It's in the second column (0.25 < 0.6 < 0.75)
        // - Relative position in column = (0.6 - 0.25) / (0.75 - 0.25) = 0.7
        // - Since 0.7 > 0.5, closest edge is "right"
        const dragState = contentTableColumnDragPluginKey.getState(view.state);
        assert(dragState?.dragging);
        const sourceIndex = dragState.dragging.startColumnIndex;

        // Get the column widths from the table attributes
        const columnWidths = table.attrs.columnWidths || Array(map.width).fill(1);

        // Calculate total width units
        let totalWidthUnits = 0;
        for (const width of columnWidths) {
            totalWidthUnits += width;
        }

        // Calculate cumulative widths for each column
        // These represent the right boundary of each column as a fraction of total width
        //
        // For columnWidths [1, 2, 1]:
        // 1. First calculate totalWidthUnits:
        // 4
        // 2. Then calculate cumulativeWidths:
        // // First column (width = 1)
        // 1/4 = 0.25

        // // Second column (width = 2)
        // (1 + 2)/4 = 3/4 = 0.75

        // // Third column (width = 1)
        // (1 + 2 + 1)/4 = 4/4 = 1.0
        const cumulativeWidths = [];
        let runningWidth = 0;
        for (const width of columnWidths) {
            runningWidth += width;
            cumulativeWidths.push(runningWidth / totalWidthUnits);
        }

        // Calculate relative mouse position in terms of total width (0 to 1)
        const relativeX = (event.clientX - tableRect.left) / tableRect.width;

        // Find target column based on relative position
        let targetIndex = columnWidths.length - 1;
        for (let i = 0; i < cumulativeWidths.length; i++) {
            if (relativeX <= cumulativeWidths[i]!) {
                targetIndex = i;
                break;
            }
        }

        // Calculate edge position more precisely using the column boundaries
        const leftBoundary = targetIndex === 0 ? 0 : cumulativeWidths[targetIndex - 1]!;
        const rightBoundary = cumulativeWidths[targetIndex]!;
        const columnRelativePosition = (relativeX - leftBoundary) / (rightBoundary - leftBoundary);
        const closestEdge = columnRelativePosition > 0.5 ? "right" : ("left" as Edge);

        return {
            sourceIndex,
            targetType: draggableType,
            targetIndex,
            targetAdjustedIndex: clamp(0, targetIndex, map.width - 1),
            targetClosestEdge: closestEdge,
        };
    } else if (draggableType === DraggableType.TABLE_ROW) {
        const dragState = contentTableRowDragPluginKey.getState(view.state);
        assert(dragState?.dragging);
        const sourceIndex = dragState.dragging.startRowIndex;

        // Get single row height by dividing total height by number of rows
        const singleRowHeight = tableRect.height / map.height;

        // Get mouse position relative to table top
        const relativeMouseY = event.clientY - tableRect.top;

        // Handle out of bounds cases
        if (relativeMouseY < 0) {
            // Above table - clamp to first row
            return {
                sourceIndex,
                targetType: draggableType,
                targetIndex: 0,
                targetAdjustedIndex: 0,
                targetClosestEdge: sourceIndex === 0 ? "top" : "bottom",
            };
        }

        if (relativeMouseY > tableRect.height) {
            // Below table - clamp to last row
            return {
                sourceIndex,
                targetType: draggableType,
                targetIndex: map.height - 1,
                targetAdjustedIndex: map.height - 1,
                targetClosestEdge: sourceIndex === map.height - 1 ? "bottom" : "top",
            };
        }

        // Calculate which row we're on by dividing relative position by single row height
        // const targetIndex = Math.min(Math.floor(relativeMouseY / singleRowHeight), map.height - 1);
        const targetIndex = Math.floor(relativeMouseY / singleRowHeight);

        // Calculate how far into the current row the mouse is
        const positionInRow = relativeMouseY % singleRowHeight;
        const closestEdge = positionInRow > singleRowHeight / 2 ? "bottom" : ("top" as Edge);
        // Adjust target index based on edge

        const targetAdjustedIndex = targetIndex;
        // if (closestEdge === "bottom") {
        //     targetAdjustedIndex = Math.min(targetIndex + 1, map.height - 1);
        // }
        // console.log({targetIndex, closestEdge, targetAdjustedIndex});

        return {
            sourceIndex,
            targetType: draggableType,
            targetIndex,
            targetAdjustedIndex: Math.min(targetAdjustedIndex, map.height - 1),
            targetClosestEdge: closestEdge,
        };
    }
};
