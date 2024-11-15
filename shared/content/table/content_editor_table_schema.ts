import classNames from "classnames";
import {Node} from "prosemirror-model";

import {
    tableAlignClassName,
    tableCellClassName,
    tableClassName,
    tableHeaderClassName,
} from "~/shared/content/content_styles.js";
import {Schema} from "~/shared/schema/schema.js";

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
        return ["th", {class: tableHeaderClassName}, 0] as const;
    },
    copyable: true,
};
