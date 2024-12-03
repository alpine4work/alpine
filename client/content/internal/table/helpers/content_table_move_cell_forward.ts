import {ResolvedPos} from "prosemirror-model";

/**
 * Moves the position forward to the next cell.
 *
 * Example usage:
 * const nextCellPos = moveCellForward($pos);
 * console.log(`Next cell position: ${nextCellPos.pos}`);
 *
 * This function is useful for navigating through cells in a table.
 */
export function contentTableMoveCellForward($pos: ResolvedPos): ResolvedPos {
    return $pos.node(0).resolve($pos.pos + $pos.nodeAfter!.nodeSize);
}
