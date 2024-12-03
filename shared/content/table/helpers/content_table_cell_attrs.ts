// TODO(rohitt-gupta, #tables): Remove colspan and colwidth once we fork
// all the components from prosemirror-tables and update the schema.
export interface ContentTableCellAttrs {
    colspan: number;
    rowspan: number;
    colwidth: Array<number> | null;
}
