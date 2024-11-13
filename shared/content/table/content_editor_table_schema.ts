import classNames from "classnames";
import {Node} from "prosemirror-model";
import {Command, EditorState, TextSelection, Transaction} from "prosemirror-state";
import {
    CellSelection,
    addColumnAfter,
    addColumnBefore,
    addRowAfter,
    addRowBefore,
    columnResizing,
    deleteColumn,
    deleteRow,
    deleteTable,
    fixTables,
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

// table: {
//     content: "tableRow+",
//     tableRole: "table",
//     isolating: true,
//     group: "block",
//     parseDOM: [{tag: "table"}],
//     toDOM() {
//         return ["table", 0];
//     },
// },
// tableRow: {
//     content: "tableCell+",
//     tableRole: "row",
//     parseDOM: [{tag: "tr"}],
//     toDOM() {
//         return ["tr", 0];
//     },
// },
// tableCell: {
//     content: "block+",
//     tableRole: "cell",
//     parseDOM: [{tag: "td"}],
//     toDOM() {
//         return ["td", 0];
//     },
// },
export const tableNode = {
    content: "tableRow+",
    group: "block",
    isolating: true,
    selectable: true,
    draggable: true,

    // Rendering
    toDOM: (node: Node) => {
        return [
            "table",
            {
                class: classNames(tableClassName, {
                    [tableAlignClassName]: node.attrs.alignment !== "left",
                }),
            },
            0,
        ] as const;
    },

    parseDOM: [
        {
            tag: "table",
            getAttrs: (dom: Element) => ({
                alignment: dom.getAttribute("data-alignment") || "left",
            }),
        },
    ],

    commands: {
        addColumnBefore: (): Command => (state, dispatch) => {
            return addColumnBefore(state, dispatch);
        },
        addColumnAfter: (): Command => (state, dispatch) => {
            console.log("addColumnAfter", state);
            return addColumnAfter(state, dispatch);
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
                fixTables(state);
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
                if (dispatch) {
                    dispatch(
                        state.tr.setNodeMarkup(state.selection.$anchor.pos, null, {
                            ...state.selection.$anchor.parent.attrs,
                            alignment: attrs.alignment,
                        }),
                    );
                }
                return true;
            },
    },
};

export const tableRow = {
    content: "(paragraph | tableCell)+",
    tableRole: "row",
    selectable: true,
    draggable: true,
    parseDOM: [{tag: "tr"}],
    toDOM() {
        return ["tr", 0] as const;
    },
};

export const tableCell = {
    group: "block",
    content: "block+",
    tableRole: "cell",
    selectable: true,
    draggable: true,

    // attrs: {
    //     colspan: {default: 1, schema: Schema.integer.default(1)},
    //     rowspan: {default: 1, schema: Schema.integer.default(1)},
    // },
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
