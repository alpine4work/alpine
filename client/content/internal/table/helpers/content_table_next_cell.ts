import {ResolvedPos} from "prosemirror-model";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";

/**

 * Finds the next cell in the specified direction.
 *
 * Example usage:
 * const nextCellPos = nextCell($pos, 'horiz', 1);
 * console.log(`Next cell position: ${nextCellPos}`);
 *
 * This function is useful for navigating through cells in a specified direction.
 */
export function contentTableNextCell(
    $pos: ResolvedPos,
    axis: "horiz" | "vert",
    dir: number,
): ResolvedPos | null {
    const table = $pos.node(-1);
    const map = ContentTableMap.get(table);
    const tableStart = $pos.start(-1);

    const moved = map.nextCell($pos.pos - tableStart, axis, dir);
    return moved == null ? null : $pos.node(0).resolve(tableStart + moved);
}
