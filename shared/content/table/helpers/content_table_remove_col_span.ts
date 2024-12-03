import {ContentTableCellAttrs} from "~/shared/content/table/helpers/content_table_cell_attrs.js";

/**
 * Removes a column span from the cell attributes.
 *
 * Example usage:
 * const updatedAttrs = removeColSpan(cellAttrs, pos);
 * console.log(`Updated attributes: ${updatedAttrs}`);
 *
 * This function is useful for adjusting the column span of a cell.
 */
export function contentTableRemoveColSpan(
    attrs: ContentTableCellAttrs,
    pos: number,
    n = 1,
): ContentTableCellAttrs {
    const result: ContentTableCellAttrs = {...attrs, colspan: attrs.colspan - n};

    if (result.colwidth) {
        result.colwidth = result.colwidth.slice();
        result.colwidth.splice(pos, n);
        if (!result.colwidth.some(w => w > 0)) result.colwidth = null;
    }
    return result;
}
