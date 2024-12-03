import {Attrs, Node, ResolvedPos} from "prosemirror-model";
// Various helper functions for working with tables

import {EditorState, NodeSelection, PluginKey} from "prosemirror-state";
import {CellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {contentTableNodeTypes} from "~/shared/content/table/content_table_schema.js";
import {Rect, TableMap} from "~/shared/content/table/tablemap.js";

export type MutableAttrs = Record<string, unknown>;

export interface CellAttrs {
    colspan: number;
    rowspan: number;
    colwidth: Array<number> | null;
}

/**
 * @public
 * A unique key for tracking table editing state in ProseMirror.
 */
export const tableEditingKey = new PluginKey<number>("selectingCells");

/**
 * @public
 * Retrieves the resolved position of the cell surrounding the given position.
 *
 * Example usage:
 * const cellPosition = cellAround($pos);
 * console.log(`Cell position: ${cellPosition}`);
 *
 * This function is useful for determining the cell context of a given position.
 */
export function cellAround($pos: ResolvedPos): ResolvedPos | null {
    for (let d = $pos.depth - 1; d > 0; d--)
        if ($pos.node(d).type.spec.tableRole == "row")
            return $pos.node(0).resolve($pos.before(d + 1));
    return null;
}

/**
 * @public
 * Finds the cell wrapping the given position.
 *
 * Example usage:
 * const wrappedCell = cellWrapping($pos);
 * console.log(`Wrapped cell: ${wrappedCell}`);
 *
 * This function helps in identifying the cell node that wraps around a specific position.
 */
export function cellWrapping($pos: ResolvedPos): null | Node {
    for (let d = $pos.depth; d > 0; d--) {
        const role = $pos.node(d).type.spec.tableRole;
        if (role === "cell" || role === "header_cell") return $pos.node(d);
    }
    return null;
}

/**
 * @public
 * Checks if the current selection is within a table.
 *
 * Example usage:
 * const inTable = isInTable(state);
 * console.log(`Is in table: ${inTable}`);
 *
 * This function is useful for validating if operations should be performed within a table context.
 */
export function isInTable(state: EditorState): boolean {
    const $head = state.selection.$head;
    for (let d = $head.depth; d > 0; d--)
        if ($head.node(d).type.spec.tableRole == "row") return true;
    return false;
}

/**
 * @internal
 * Retrieves the resolved position of the currently selected table cell in the editor state.
 *
 * Example usage:
 * const selectedCellPos = selectionCell(editorState);
 * console.log(`Selected cell position: ${selectedCellPos.pos}`);
 *
 * This function is useful when you need to perform operations on the selected cell, such as
 * modifying its attributes or content.
 */
export function selectionCell(state: EditorState): ResolvedPos {
    const sel = state.selection as CellSelection | NodeSelection;
    if ("$anchorCell" in sel && sel.$anchorCell) {
        return sel.$anchorCell.pos > sel.$headCell.pos ? sel.$anchorCell : sel.$headCell;
    } else if ("node" in sel && sel.node && sel.node.type.spec.tableRole == "cell") {
        return sel.$anchor;
    }
    const $cell = cellAround(sel.$head) || cellNear(sel.$head);
    if ($cell) {
        return $cell;
    }
    throw new RangeError(`No cell found around position ${sel.head}`);
}

/**
 * @public
 * Finds the nearest cell to the given position.
 *
 * Example usage:
 * const nearestCell = cellNear($pos);
 * console.log(`Nearest cell: ${nearestCell}`);
 *
 * This function is useful for navigating to the closest cell in a table.
 */
export function cellNear($pos: ResolvedPos): ResolvedPos | undefined {
    for (let after = $pos.nodeAfter, pos = $pos.pos; after; after = after.firstChild, pos++) {
        const role = after.type.spec.tableRole;
        if (role == "cell" || role == "header_cell") return $pos.doc.resolve(pos);
    }
    for (let before = $pos.nodeBefore, pos = $pos.pos; before; before = before.lastChild, pos--) {
        const role = before.type.spec.tableRole;
        if (role == "cell" || role == "header_cell") return $pos.doc.resolve(pos - before.nodeSize);
    }
}

/**
 * @public
 * Checks if the given position points at a cell.
 *
 * Example usage:
 * const isPointingAtCell = pointsAtCell($pos);
 * console.log(`Points at cell: ${isPointingAtCell}`);
 *
 * This function is useful for determining if the current position is directly within a cell.
 */
export function pointsAtCell($pos: ResolvedPos): boolean {
    return $pos.parent.type.spec.tableRole == "row" && !!$pos.nodeAfter;
}

/**
 * @public
 * Moves the position forward to the next cell.
 *
 * Example usage:
 * const nextCellPos = moveCellForward($pos);
 * console.log(`Next cell position: ${nextCellPos.pos}`);
 *
 * This function is useful for navigating through cells in a table.
 */
export function moveCellForward($pos: ResolvedPos): ResolvedPos {
    return $pos.node(0).resolve($pos.pos + $pos.nodeAfter!.nodeSize);
}

/**
 * @internal
 * Checks if two cells are in the same table.
 *
 * Example usage:
 * const sameTable = inSameTable($cellA, $cellB);
 * console.log(`In same table: ${sameTable}`);
 *
 * This function is useful for validating operations that depend on cell relationships.
 */
export function inSameTable($cellA: ResolvedPos, $cellB: ResolvedPos): boolean {
    return (
        $cellA.depth == $cellB.depth &&
        $cellA.pos >= $cellB.start(-1) &&
        $cellA.pos <= $cellB.end(-1)
    );
}

/**
 * @public
 * Finds the cell at the given position.
 *
 * Example usage:
 * const cellRect = findCell($pos);
 * console.log(`Cell rectangle: ${cellRect}`);
 *
 * This function is useful for obtaining the rectangular area of a specific cell.
 */
export function findCell($pos: ResolvedPos): Rect {
    return TableMap.get($pos.node(-1)).findCell($pos.pos - $pos.start(-1));
}

/**
 * @public
 * Counts the number of columns in the table at the given position.
 *
 * Example usage:
 * const columnCount = colCount($pos);
 * console.log(`Column count: ${columnCount}`);
 *
 * This function is useful for determining the structure of the table.
 */
export function colCount($pos: ResolvedPos): number {
    return TableMap.get($pos.node(-1)).colCount($pos.pos - $pos.start(-1));
}

/**
 * @public
 * Finds the next cell in the specified direction.
 *
 * Example usage:
 * const nextCellPos = nextCell($pos, 'horiz', 1);
 * console.log(`Next cell position: ${nextCellPos}`);
 *
 * This function is useful for navigating through cells in a specified direction.
 */
export function nextCell(
    $pos: ResolvedPos,
    axis: "horiz" | "vert",
    dir: number,
): ResolvedPos | null {
    const table = $pos.node(-1);
    const map = TableMap.get(table);
    const tableStart = $pos.start(-1);

    const moved = map.nextCell($pos.pos - tableStart, axis, dir);
    return moved == null ? null : $pos.node(0).resolve(tableStart + moved);
}

/**
 * @public
 * Removes a column span from the cell attributes.
 *
 * Example usage:
 * const updatedAttrs = removeColSpan(cellAttrs, pos);
 * console.log(`Updated attributes: ${updatedAttrs}`);
 *
 * This function is useful for adjusting the column span of a cell.
 */
export function removeColSpan(attrs: CellAttrs, pos: number, n = 1): CellAttrs {
    const result: CellAttrs = {...attrs, colspan: attrs.colspan - n};

    if (result.colwidth) {
        result.colwidth = result.colwidth.slice();
        result.colwidth.splice(pos, n);
        if (!result.colwidth.some(w => w > 0)) result.colwidth = null;
    }
    return result;
}

/**
 * @public
 * Adds a column span to the cell attributes.
 *
 * Example usage:
 * const updatedAttrs = addColSpan(cellAttrs, pos);
 * console.log(`Updated attributes: ${updatedAttrs}`);
 *
 * This function is useful for expanding the column span of a cell.
 */
export function addColSpan(attrs: CellAttrs, pos: number, n = 1): Attrs {
    const result = {...attrs, colspan: attrs.colspan + n};
    if (result.colwidth) {
        result.colwidth = result.colwidth.slice();
        for (let i = 0; i < n; i++) result.colwidth.splice(pos, 0, 0);
    }
    return result;
}

/**
 * @public
 * Checks if the specified column is a header column.
 *
 * Example usage:
 * const isHeader = columnIsHeader(map, table, col);
 * console.log(`Is header column: ${isHeader}`);
 *
 * This function is useful for validating the structure of a table.
 */
export function columnIsHeader(map: TableMap, table: Node, col: number): boolean {
    const headerCell = contentTableNodeTypes(table.type.schema).header_cell;
    for (let row = 0; row < map.height; row++)
        if (table.nodeAt(map.map[col + row * map.width]!)!.type != headerCell) return false;
    return true;
}
