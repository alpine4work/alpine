import {ResolvedPos} from "prosemirror-model";

/**
 * Checks if the given position points at a cell.
 *
 * Example usage:
 * const isPointingAtCell = pointsAtCell($pos);
 * console.log(`Points at cell: ${isPointingAtCell}`);
 *
 * This function is useful for determining if the current position is directly within a cell.
 */
export function contentTablePointsAtCell($pos: ResolvedPos): boolean {
    return $pos.parent.type.spec.tableRole == "row" && !!$pos.nodeAfter;
}
