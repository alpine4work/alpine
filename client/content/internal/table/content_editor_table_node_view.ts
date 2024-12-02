/**
 * NOTE(rohitt-gupta, 2024-11-26): Forked from `prosemirror-tables` so we can
 * remove features we don't use and customize the user experience. We intend to
 * modify this file a lot so each modification may not be documented.
 *
 * The MIT License
 *
 * Copyright (C) 2015-2016 by Marijn Haverbeke <marijnh@gmail.com> and others
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
import {Node} from "prosemirror-model";
import {inSameTable, isInTable} from "prosemirror-tables";
import {EditorView, NodeView} from "prosemirror-view";
import {tableClassName} from "~/shared/content/content_styles.js";
import {type ContentEditorCellAttrs} from "~/shared/content/table/content_editor_cell_attrs.js";
import {spacing} from "~/shared/design/core/spacing.js";

export class ContentEditorTableNodeView implements NodeView {
    public dom: HTMLDivElement;
    public table: HTMLTableElement;
    public colgroup: HTMLTableColElement;
    public contentDOM: HTMLTableSectionElement;

    private unsubscribeFromSelectionUpdate: (() => void) | null = null;

    constructor(
        public node: Node,
        public defaultCellMinWidth: number,
        public view: EditorView,
        public subscribeToSelectionUpdate?: (listener: () => void) => () => void,
    ) {
        this.dom = document.createElement("div");
        this.dom.className = tableClassName;
        this.dom.style.display = "flex";
        this.dom.style.alignItems = "stretch";
        this.dom.setAttribute("data-scrollbar", "false");
        this.table = this.dom.appendChild(document.createElement("table"));
        this.colgroup = this.table.appendChild(document.createElement("colgroup"));

        contentEditorUpdateTableColumnsOnResize(
            node,
            this.colgroup,
            this.table,
            defaultCellMinWidth,
            view,
            undefined,
            undefined,
        );
        this.contentDOM = this.table.appendChild(document.createElement("tbody"));
        this.addActiveTableClass();
        if (subscribeToSelectionUpdate) {
            this.unsubscribeFromSelectionUpdate = subscribeToSelectionUpdate(() => {
                requestAnimationFrame(() => this.addActiveTableClass());
            });
        }
    }

    addActiveTableClass = () => {
        console.log("addActiveTableClass");
        console.log("isInTable", isInTable(this.view.state));
        console.log(
            "inSameTable",
            inSameTable(this.view.state.selection.$from, this.view.state.selection.$to),
        );
        // if (isInTable(this.view.state)) {
        //     const existingIndicator = this.dom.querySelector("[data-table-active-indicator]");
        //     if (existingIndicator) {
        //         return;
        //     }
        //     const activeIndicator = document.createElement("div");
        //     activeIndicator.setAttribute("data-table-active-indicator", "");
        //     Object.assign(activeIndicator.style, {
        //         width: "30px",
        //         backgroundColor: "red",
        //         cursor: "pointer",
        //         flexShrink: "0",
        //         marginLeft: "4px",
        //     });

        //     activeIndicator.addEventListener("click", () => {
        //         console.log("clicked");
        //     });

        //     this.dom.appendChild(activeIndicator);
        // } else {
        //     const activeIndicator = this.dom.querySelector("[data-table-active-indicator]");
        //     if (activeIndicator) {
        //         activeIndicator.remove();
        //     }
        // }
    };

    update(node: Node): boolean {
        if (node.type != this.node.type) return false;
        this.node = node;
        contentEditorUpdateTableColumnsOnResize(
            node,
            this.colgroup,
            this.table,
            this.defaultCellMinWidth,
            this.view,
            undefined,
            undefined,
        );
        return true;
    }

    ignoreMutation(record: MutationRecord): boolean {
        // console.log("ignoreMutation", record);
        const isTableOrColgroup =
            record.type == "attributes" &&
            (record.target == this.table || this.colgroup.contains(record.target));
        // console.log("isTableOrColgroup", isTableOrColgroup);
        return isTableOrColgroup;
    }

    destroy() {
        console.log("destroy");
        this.unsubscribeFromSelectionUpdate?.();
    }
}

export function contentEditorUpdateTableColumnsOnResize(
    node: Node,
    colgroup: HTMLTableColElement,
    table: HTMLTableElement,
    defaultCellMinWidth: number,
    view: EditorView,
    overrideCol?: number,
    overrideValue?: number,
): void {
    let totalWidth = 0;
    let fixedWidth = true;
    let nextDOM = colgroup.firstChild as HTMLElement;
    const row = node.firstChild;
    if (!row) return;

    for (let i = 0, col = 0; i < row.childCount; i++) {
        const {colspan, colwidth} = row.child(i).attrs as ContentEditorCellAttrs;
        for (let j = 0; j < colspan; j++, col++) {
            const hasWidth = overrideCol == col ? overrideValue : colwidth && colwidth[j];
            const cssWidth = hasWidth ? hasWidth + "px" : "";
            totalWidth += hasWidth || defaultCellMinWidth;
            if (!hasWidth) fixedWidth = false;
            if (!nextDOM) {
                const col = document.createElement("col");
                col.style.width = cssWidth;
                colgroup.appendChild(col);
            } else {
                if (nextDOM.style.width != cssWidth) {
                    nextDOM.style.width = cssWidth;
                }
                nextDOM = nextDOM.nextSibling as HTMLElement;
            }
        }
    }

    while (nextDOM) {
        const after = nextDOM.nextSibling;
        nextDOM.parentNode?.removeChild(nextDOM);
        nextDOM = after as HTMLElement;
    }

    if (fixedWidth) {
        table.style.width = totalWidth + "px";
        table.style.minWidth = "";
    } else {
        table.style.width = "";
        table.style.minWidth = totalWidth + "px";
    }
}
