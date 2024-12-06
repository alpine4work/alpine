import {Node} from "prosemirror-model";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {contentTableNodeTypes} from "~/shared/content/table/content_table_schema.js";

/**

 * Checks if the specified column is a header column.
 *
 * Example usage:
 * const isHeader = columnIsHeader(map, table, col);
 * console.log(`Is header column: ${isHeader}`);
 *
 * This function is useful for validating the structure of a table.
 */
// export function contentTableColumnIsHeader(
//     map: ContentTableMap,
//     table: Node,
//     col: number,
// ): boolean {
//     const headerCell = contentTableNodeTypes(table.type.schema).header_cell;
//     for (let row = 0; row < map.height; row++)
//         if (table.nodeAt(map.map[col + row * map.width]!)!.type != headerCell) return false;
//     return true;
// }
