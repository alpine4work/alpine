import {Node, ResolvedPos} from "prosemirror-model";

/**
 * Finds the cell wrapping the given position.
 *
 * Example usage:
 * const wrappedCell = cellWrapping($pos);
 * console.log(`Wrapped cell: ${wrappedCell}`);
 *
 * This function helps in identifying the cell node that wraps around a specific position.
 */
export function contentTableCellWrapping($pos: ResolvedPos): null | Node {
    for (let d = $pos.depth; d > 0; d--) {
        const role = $pos.node(d).type.spec.tableRole;
        if (role === "cell") return $pos.node(d);
    }
    return null;
}
