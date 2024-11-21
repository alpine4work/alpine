import classNames from "classnames";
import {
    AttributeSpec,
    Node,
    NodeSpec,
    NodeType,
    Schema as ProsemirrorSchema,
} from "prosemirror-model";

import {Command} from "prosemirror-state";
import {
    CellSelection,
    addColumnAfter as addColumnAfterFromProsemirrorTables,
    addColumnBefore,
    addRowAfter,
    addRowBefore,
    columnResizing,
    deleteColumn,
    deleteRow,
    deleteTable,
    fixTables as fixTablesFromProsemirrorTables,
    goToNextCell,
    mergeCells,
    setCellAttr,
    splitCell,
    tableEditing,
    tableNodes,
    toggleHeader,
    toggleHeaderCell,
} from "prosemirror-tables";
import {
    tableAlignClassName,
    tableCellClassName,
    tableClassName,
    tableHeaderClassName,
} from "~/shared/content/content_styles.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 *  Why some defult values for colspan, rowspan, colwidth are required?
 * The default cell attributes (cellAttrs) are essential for defining the fundamental properties of each table cell in ProseMirror's table schema:
   - **colspan** (default: 1): Allows cells to span multiple columns.
   - **rowspan** (default: 1): Allows cells to span multiple rows.
   - **colwidth** (default: null): Holds information about column widths.

   These defaults ensure:
   - Regular cells function correctly (1x1 size) without needing explicit attributes.
   - The schema can effectively parse and serialize HTML tables.
   - Consistent base values for table operations (e.g., splitting and merging cells).

   Without these defaults, ProseMirror would struggle to manage basic table cell behavior and maintain the integrity of the table structure. The schema utilizes these attributes in the `getCellAttrs()` and `setCellAttrs()` functions to:
   - Parse HTML tables into ProseMirror's internal format.
   - Render ProseMirror tables back to HTML.
   - Facilitate table editing operations.
 */
const cellAttrs: Record<string, AttributeSpec> = {
    colspan: {default: 1, schema: Schema.integer},
    rowspan: {default: 1, schema: Schema.integer},
    colwidth: {default: null, schema: Schema.unknown},
};

export const table = {
    name: "table",
    content: "table_row+",
    group: "block",
    copyable: true,
    selectable: true,
    isolating: true,
    tableRole: "table",
    attrs: {
        alignment: {
            default: "center",
            schema: Schema.string,
        },
        columns: {
            default: 0,
            schema: Schema.integer,
        },
        columnWidths: {
            default: null,
            schema: Schema.unknown,
        },
    },

    // Rendering
    toDOM: (node: Node) => {
        return [
            "table",
            {
                class: classNames(tableClassName, {
                    [tableAlignClassName]: node.attrs.alignment !== "center",
                }),
            },
            0,
        ] as const;
    },

    parseDOM: [
        {
            tag: "table",
            getAttrs: (dom: Element) => ({
                alignment: dom.getAttribute("data-alignment") || "center",
            }),
        },
    ],

    commands: {
        addColumnBefore: (): Command => (state, dispatch) => {
            return addColumnBefore(state, dispatch);
        },
        addColumnAfter: (): Command => (state, dispatch) => {
            return addColumnAfterFromProsemirrorTables(state, dispatch);
        },
        deleteColumn: (): Command => (state, dispatch) => {
            return deleteColumn(state, dispatch);
        },
        addRowBefore: (): Command => (state, dispatch) => {
            return addRowBefore(state, dispatch);
        },
        addRowAfter: (): Command => (state, dispatch) => {
            return addRowAfter(state, dispatch);
        },
        deleteRow: (): Command => (state, dispatch) => {
            return deleteRow(state, dispatch);
        },
        deleteTable: (): Command => (state, dispatch) => {
            return deleteTable(state, dispatch);
        },
        mergeCells: (): Command => (state, dispatch) => {
            return mergeCells(state, dispatch);
        },
        splitCell: (): Command => (state, dispatch) => {
            return splitCell(state, dispatch);
        },
        toggleHeaderColumn: (): Command => (state, dispatch) => {
            return toggleHeader("column")(state, dispatch);
        },
        toggleHeaderRow: (): Command => (state, dispatch) => {
            return toggleHeader("row")(state, dispatch);
        },
        toggleHeaderCell: (): Command => (state, dispatch) => {
            return toggleHeaderCell(state, dispatch);
        },
        mergeOrSplit: (): Command => (state, dispatch) => {
            if (mergeCells(state, dispatch)) {
                return true;
            }
            return splitCell(state, dispatch);
        },
        setCellAttribute:
            (name: string, value: any): Command =>
            (state, dispatch) => {
                return setCellAttr(name, value)(state, dispatch);
            },
        goToNextCell: (): Command => (state, dispatch) => {
            return goToNextCell(1)(state, dispatch);
        },
        goToPreviousCell: (): Command => (state, dispatch) => {
            return goToNextCell(-1)(state, dispatch);
        },
        fixTables: (): Command => (state, dispatch) => {
            if (dispatch) {
                fixTablesFromProsemirrorTables(state);
            }
            return true;
        },
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
        setAlignment:
            (attrs: {alignment: "left" | "center" | "right"}): Command =>
            (state, dispatch) => {
                if (!dispatch) {
                    return true;
                }

                console.log("setAlignment", attrs);
                const $anchor = state.selection.$anchor;
                const pos = $anchor.before($anchor.depth);

                dispatch(
                    state.tr.setNodeMarkup(pos, null, {
                        ...state.selection.$anchor.parent.attrs,
                        alignment: attrs.alignment,
                    }),
                );
                return true;
            },
    },
};

export const tableRow = {
    name: "table_row",
    content: "(table_cell | tableHeader)+",
    tableRole: "row",
    isolating: true,
    selectable: true,
    copyable: true,
    parseDOM: [{tag: "tr"}],
    toDOM() {
        return ["tr", 0] as const;
    },
};

export const tableCell = {
    name: "table_cell",
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

export const tableHeader = {
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

export function tableNodeTypes(schema: ProsemirrorSchema): Record<TableRole, NodeType> {
    let result = schema.cached.tableNodeTypes;
    if (!result) {
        result = schema.cached.tableNodeTypes = {};
        for (const name in schema.nodes) {
            const type = schema.nodes[name];
            const role = type?.spec.tableRole;
            if (role) result[role] = type;
        }
    }
    return result;
}

export type TableNodes = Record<"table" | "tableRow" | "tableCell" | "tableHeader", NodeSpec>;
export type TableRole = "table" | "row" | "cell" | "header_cell";
