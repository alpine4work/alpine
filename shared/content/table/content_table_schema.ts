import "~/shared/content/table/content_table_cell_selection.js";

import {NodeSpec, NodeType, Schema as ProsemirrorSchema} from "prosemirror-model";
import {tableCellClassName, tableClassName} from "~/shared/content/content_styles.js";

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
    content: "tableCell+",
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
    parseDOM: [{tag: "td"}],
    toDOM() {
        return ["td", {class: tableCellClassName}, 0] as const;
    },
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
export type contentTableNodes = Record<"table" | "tableRow" | "tableCell", NodeSpec>;
export type contentTableRole = "table" | "row" | "cell";
