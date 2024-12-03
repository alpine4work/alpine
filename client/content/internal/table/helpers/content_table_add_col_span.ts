import {Attrs} from "prosemirror-model";
import {ContentTableCellAttrs} from "~/shared/content/table/helpers/content_table_cell_attrs.js";

/**
 * Adds a column span to the cell attributes.
 *
 * Example usage:
 * const updatedAttrs = addColSpan(cellAttrs, pos);
 * console.log(`Updated attributes: ${updatedAttrs}`);
 *
 * This function is useful for expanding the column span of a cell.
 */
export function contentTableAddColSpan(attrs: ContentTableCellAttrs, pos: number, n = 1): Attrs {
    const result = {...attrs, colspan: attrs.colspan + n};
    if (result.colwidth) {
        result.colwidth = result.colwidth.slice();
        for (let i = 0; i < n; i++) result.colwidth.splice(pos, 0, 0);
    }
    return result;
}
