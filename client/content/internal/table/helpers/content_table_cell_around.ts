import {ResolvedPos} from "prosemirror-model";

/**

 * Retrieves the resolved position of the cell surrounding the given position.
 *
 * Example usage:
 * const cellPosition = contentTableCellAround($pos);
 * console.log(`Cell position: ${cellPosition}`);
 *
 * This function is useful for determining the cell context of a given position.
 */
export function contentTableCellAround($pos: ResolvedPos): ResolvedPos | null {
    for (let d = $pos.depth - 1; d > 0; d--)
        if ($pos.node(d).type.spec.tableRole == "row")
            return $pos.node(0).resolve($pos.before(d + 1));
    return null;
}
