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

// this file has been modified to remove features we don't use and customize the
// user experience. You can find the original file in the `prosemirror-tables`
// package at https://github.com/ProseMirror/prosemirror-tables/blob/master/src/tableview.ts
import {Node} from "prosemirror-model";
import {EditorView, NodeView} from "prosemirror-view";
import {
    getRemPxWithoutListening,
    getTableUnitPxWithoutListening,
    subscribeToSpacingScaleChange,
} from "~/client/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {tableClassName} from "~/shared/content/content_styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {tableUnitPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";

export class ContentEditorTableNodeView implements NodeView {
    public dom: HTMLDivElement;
    public table: HTMLTableElement;
    public colgroup: HTMLTableColElement;
    public contentDOM: HTMLTableSectionElement;

    private unsubscribeFromSelectionUpdate: (() => void) | null = null;
    private unsubscribeFromSpacingScale: (() => void) | null = null;

    constructor(
        public node: Node,
        public defaultCellMinWidth: number, // in rem
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
        );
        this.contentDOM = this.table.appendChild(document.createElement("tbody"));
        this.addActiveTableClass();

        // Subscribe to spacing scale changes
        this.unsubscribeFromSpacingScale = subscribeToSpacingScaleChange(() => {
            contentEditorUpdateTableColumnsOnResize(
                this.node,
                this.colgroup,
                this.table,
                this.defaultCellMinWidth,
            );
        });

        if (subscribeToSelectionUpdate) {
            this.unsubscribeFromSelectionUpdate = subscribeToSelectionUpdate(() => {
                requestAnimationFrame(() => this.addActiveTableClass());
            });
        }
    }

    addActiveTableClass = () => {
        console.log("addActiveTableClass");
    };
    update(node: Node): boolean {
        if (node.type != this.node.type) return false;
        this.node = node;
        contentEditorUpdateTableColumnsOnResize(
            node,
            this.colgroup,
            this.table,
            this.defaultCellMinWidth,
        );
        return true;
    }

    ignoreMutation(record: MutationRecord): boolean {
        return (
            record.type == "attributes" &&
            (record.target == this.table || this.colgroup.contains(record.target))
        );
    }

    destroy() {
        this.unsubscribeFromSelectionUpdate?.();
        this.unsubscribeFromSpacingScale?.();
    }
}
export function contentEditorUpdateTableColumnsOnResize(
    node: Node,
    colgroup: HTMLTableColElement,
    table: HTMLTableElement,
    defaultCellMinWidth: number, // in rem
    overrideCol?: number, // column number in 0-indexed format to override
    overrideValue?: number, // value to override in rem
): void {
    let totalWidth = 0; // in rem
    let fixedWidth = true;
    let nextDOM = colgroup.firstChild as HTMLElement;

    const columnsWidth = node.attrs.columnsWidth;
    const columnCount = node.firstChild?.childCount ?? 0;

    // Ensure we have enough cols in colgroup
    for (let col = 0; col < columnCount; col++) {
        // Width is always in rem
        const width = overrideCol == col ? overrideValue : columnsWidth?.[col];

        const cssWidth = width ? `${width * getTableUnitPxWithoutListening()}px` : "";
        totalWidth += width;

        console.log({width, cssWidth});

        if (!width) {
            fixedWidth = false;
        }
        if (!nextDOM) {
            const colElement = document.createElement("col");
            colElement.style.width = cssWidth === "" ? "auto" : cssWidth;
            colgroup.appendChild(colElement);
        } else {
            if (nextDOM.style.width !== cssWidth) {
                nextDOM.style.width = cssWidth;
            }
            nextDOM = nextDOM.nextSibling as HTMLElement;
        }
    }

    // Remove any extra cols
    while (nextDOM) {
        const after = nextDOM.nextSibling;
        nextDOM.parentNode?.removeChild(nextDOM);
        nextDOM = after as HTMLElement;
    }

    console.log({
        totalWidth,
        spacingContextInPx: getTableUnitPxWithoutListening(),
    });

    // Update table width - all values are in rem
    if (fixedWidth) {
        table.style.width = `${totalWidth * getTableUnitPxWithoutListening()}px`;
    } else {
        table.style.width = "";
    }
    table.style.minWidth = contentStyles.blockMaxWidthVar;
    // table.style.minWidth = ""; // m÷aintain a min width
}
