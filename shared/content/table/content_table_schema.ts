import "prosemirror-tables";

import {AttributeSpec, NodeSpec, NodeType, Schema as ProsemirrorSchema} from "prosemirror-model";
import {
    tableCellClassName,
    tableClassName,
    tableHeaderClassName,
} from "~/shared/content/content_styles.js";
import {Schema} from "~/shared/schema/schema.js";

// TODO(rohitt-gupta, 2024-11-26): setting default values to keep the prosemirror-tables working.
// This will be removed in the next PR.
const cellAttrs: Record<string, AttributeSpec> = {
    colspan: {default: 1, schema: Schema.integer},
    rowspan: {default: 1, schema: Schema.integer},
    colwidth: {default: null, schema: Schema.array(Schema.integer).nullable()},
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
    content: "tableBlock+",
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
    content: "tableBlock+",
    selectable: true,
    isolating: true,
    copyable: true,
    tableRole: "header_cell",
    parseDOM: [{tag: "th"}],
    toDOM() {
        return ["th", {class: tableHeaderClassName}, 0] as const; // added class to match the css
    },
    attrs: cellAttrs, //TODO(rohitt-gupta, 2024-11-26): remove this once we have a better way to handle table cell attrs
};

// TODO(rohitt-gupta, 2024-11-26): simplify the logic once we have a better way to handle table node types
// Comment by (caleb, 2024-11-26)
// https://github.com/cyberworlds/cyberworlds/pull/45#discussion_r1858723295
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
export type contentTableRole = "table" | "row" | "cell" | "header_cell";
