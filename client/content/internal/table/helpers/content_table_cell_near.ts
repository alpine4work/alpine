import {ResolvedPos} from "prosemirror-model";

/**

 * Finds the nearest cell to the given position.
 *
 * Example usage:
 * const nearestCell = cellNear($pos);
 * console.log(`Nearest cell: ${nearestCell}`);
 *
 * This function is useful for navigating to the closest cell in a table.
 */
export function contentTableCellNear($pos: ResolvedPos): ResolvedPos | undefined {
    for (let after = $pos.nodeAfter, pos = $pos.pos; after; after = after.firstChild, pos++) {
        const role = after.type.spec.tableRole;
        if (role == "cell") return $pos.doc.resolve(pos);
    }
    for (let before = $pos.nodeBefore, pos = $pos.pos; before; before = before.lastChild, pos--) {
        const role = before.type.spec.tableRole;
        if (role == "cell") return $pos.doc.resolve(pos - before.nodeSize);
    }
}
