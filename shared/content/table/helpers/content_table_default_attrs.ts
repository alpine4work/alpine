import {ContentTableCellAttrs} from "~/shared/content/table/helpers/content_table_cell_attrs.js";

export const contentTableCellDefaultAttrs: Record<string, number | null> = {
    colspan: 1,
    rowspan: 1,
    colwidth: null,
} satisfies ContentTableCellAttrs;
