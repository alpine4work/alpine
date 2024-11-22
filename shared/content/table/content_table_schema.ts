import {AttributeSpec, NodeSpec, NodeType, Schema as ProsemirrorSchema} from "prosemirror-model";
import {Command} from "prosemirror-state";
import {CellSelection} from "prosemirror-tables";
import {
    tableCellClassName,
    tableClassName,
    tableHeaderClassName,
} from "~/shared/content/content_styles.js";
import {Schema} from "~/shared/schema/schema.js";

// setting default values to keep the prosemirror-tables working.
// This will be removed in the next PR.
const cellAttrs: Record<string, AttributeSpec> = {
    colspan: {default: 1, schema: Schema.integer},
    rowspan: {default: 1, schema: Schema.integer},
    colwidth: {default: null, schema: Schema.unknown},
};

export const contentTableProsemirrorNodeSpec = {
    name: "table",
    content: "tableRow+",
    group: "block",
    copyable: true,
    selectable: true,
    isolating: true,
    tableRole: "table",
    parseDOM: [{tag: "table"}],
    toDOM() {
        return ["table", {class: tableClassName}, ["tbody", 0]] as const;
    },
    commands: {
        // this helps in cell resizing. we should remove it from schema and move
        // it to the table node view or any other file that forks of prosemirror-tables.
        setCellSelection:
            (position: {anchorCell: number; headCell: number}): Command =>
            (state, dispatch) => {
                if (dispatch) {
                    const selection = CellSelection.create(
                        state.tr.doc,
                        position.anchorCell,
                        position.headCell,
                    );
                    state.tr.setSelection(selection);
                }
                return true;
            },
    },
};

export const contentTableRowProsemirrorNodeSpec = {
    name: "tableRow",
    content: "(tableCell | tableHeader)+",
    tableRole: "row",
    isolating: true,
    selectable: true,
    copyable: true,
    parseDOM: [{tag: "tr"}],
    toDOM() {
        return ["tr", 0] as const;
    },
};

export const contentTableCellProsemirrorNodeSpec = {
    name: "tableCell",
    group: "block",
    content: "block+",
    tableRole: "cell",
    selectable: true,
    isolating: true,
    copyable: true,

    attrs: cellAttrs,
    parseDOM: [{tag: "td"}],
    toDOM() {
        return ["td", {class: tableCellClassName}, 0] as const;
    },
};

export const contentTableHeaderProsemirrorNodeSpec = {
    name: "tableHeader", // name must match the name in the column definition
    content: "block+",
    selectable: true,
    isolating: true,
    copyable: true,
    tableRole: "header_cell",
    parseDOM: [{tag: "th"}],
    toDOM() {
        return ["th", {class: tableHeaderClassName}, 0] as const; // added class to match the css
    },
    attrs: cellAttrs, // mandatory for table to work
};

export function contentTableNodeTypes(
    schema: ProsemirrorSchema,
): Record<contentTableRole, NodeType> {
    let result = schema.cached.contentTableNodeTypes;
    if (!result) {
        result = schema.cached.contentTableNodeTypes = {};
        for (const name in schema.nodes) {
            const type = schema.nodes[name];
            const role = type?.spec.tableRole;
            if (role) result[role] = type;
        }
    }
    return result;
}

export type contentTableNodes = Record<
    "table" | "tableRow" | "tableCell" | "tableHeader",
    NodeSpec
>;
type contentTableRole = "table" | "row" | "cell" | "header_cell";
