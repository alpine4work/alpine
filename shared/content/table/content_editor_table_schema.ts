import classNames from "classnames";
import {Node} from "prosemirror-model";

import {Command, EditorState, TextSelection, Transaction} from "prosemirror-state";
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
    toggleHeader,
    toggleHeaderCell,
} from "prosemirror-tables";
import {
    tableAlignClassName,
    tableCellClassName,
    tableClassName,
} from "~/shared/content/content_styles.js";
import {Schema} from "~/shared/schema/schema.js";

// table: {
//     content: "table_row+",
//     tableRole: "table",
//     isolating: true,
//     group: "block",
//     parseDOM: [{tag: "table"}],
//     toDOM() {
//         return ["table", 0];
//     },
// },
// table_row: {
//     content: "table_cell+",
//     tableRole: "row",
//     parseDOM: [{tag: "tr"}],
//     toDOM() {
//         return ["tr", 0];
//     },
// },
// table_cell: {
//     content: "block+",
//     tableRole: "cell",
//     parseDOM: [{tag: "td"}],
//     toDOM() {
//         return ["td", 0];
//     },
// },
export const table = {
    name: "table",
    content: "table_row+",
    group: "block",
    isolating: true,
    selectable: true,
    draggable: true,
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
            console.log("Executing addColumnAfter command", state, dispatch);
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
    copyable: true,
};

export const table_row = {
    name: "table_row",
    content: "(table_cell | table_header)+",
    tableRole: "row",
    selectable: true,
    draggable: true,
    parseDOM: [{tag: "tr"}],
    toDOM() {
        return ["tr", 0] as const;
    },
    copyable: true,
};

export const table_cell = {
    name: "table_cell",
    group: "block",
    content: "block+",
    tableRole: "cell",
    selectable: true,
    copyable: true,
    draggable: true,

    attrs: {
        colspan: {default: 1, schema: Schema.integer},
        rowspan: {default: 1, schema: Schema.integer},
        colwidth: {default: null, schema: Schema.unknown},
        // colwidth: {default: null, schema: Schema.array(Schema.integer)},
    },
    parseDOM: [
        {
            tag: "td",
            getAttrs: (dom: Element) => ({
                colspan: Number(dom.getAttribute("colspan")) || 1,
                rowspan: Number(dom.getAttribute("rowspan")) || 1,
            }),
        },
    ],
    toDOM(node: Node) {
        const {colspan, rowspan} = node.attrs;
        return [
            "td",
            {
                class: tableCellClassName,
                colspan: colspan > 1 ? colspan : null,
                rowspan: rowspan > 1 ? rowspan : null,
            },
            0,
        ] as const;
    },
};

export const table_header = {
    name: "table_header",
    content: "block+",
    selectable: true,
    // attrs: cellAttrs,
    attrs: {
        // Add these attributes
        colspan: {default: 1, schema: Schema.integer},
        rowspan: {default: 1, schema: Schema.integer},
        colwidth: {default: null, schema: Schema.unknown},
    },
    tableRole: "header_cell",
    isolating: true,
    parseDOM: [{tag: "th"}],
    toDOM() {
        return ["th", 0] as const;
    },
    copyable: true,
};
