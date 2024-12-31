/**
 * NOTE(rohitt-gupta, 2024-11-26): This file has been modified to remove
 * features we don't use and customize the user experience. You can find the
 * original file in the `prosemirror-tables` package at:
 * https://github.com/ProseMirror/prosemirror-tables/blob/582b4e45b70da49472eed91698e5d3ecfbfcf5eb/src/tableview.ts
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
import {EditorView, NodeView} from "prosemirror-view";
import {getPlatformWithoutListening} from "~/client/remix/platform_context.js";
import {
    getTableUnitPxWithoutListening,
    subscribeToSpacingScaleChange,
} from "~/client/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {tableClassName} from "~/shared/content/content_styles.js";

export class ContentEditorTableNodeView implements NodeView {
    public dom: HTMLDivElement;
    public table: HTMLTableElement;
    public colgroup: HTMLTableColElement;
    public contentDOM: HTMLTableSectionElement;

    private readonly unsubscribeFromSelectionUpdate: (() => void) | null = null;
    private readonly unsubscribeFromSpacingScale: (() => void) | null = null;
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

        updateContentTableColumnsOnResize(node, this.colgroup, this.table, defaultCellMinWidth);
        this.contentDOM = this.table.appendChild(document.createElement("tbody"));
        this.addActiveTableClass();

        // Subscribe to spacing scale changes
        this.unsubscribeFromSpacingScale = subscribeToSpacingScaleChange(() => {
            updateContentTableColumnsOnResize(
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
        updateContentTableColumnsOnResize(
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

export function updateContentTableColumnsOnResize(
    node: Node,
    colgroup: HTMLTableColElement,
    table: HTMLTableElement,
    defaultCellMinWidth: number,
    overrideCol?: number,
    overrideValue?: number,
): void {
    let totalWidth = 0;
    let nextDOM = colgroup.firstChild as HTMLElement;

    // NOCOMMIT: Update this
    const columnWidths = node.attrs.columnWidths;
    const columnCount = node.firstChild?.childCount ?? 0;
    const defaultWidth =
        contentStyles.blockMaxWidthRem[getPlatformWithoutListening()] / columnCount;

    // Ensure we have enough cols in colgroup
    for (let colIndex = 0; colIndex < columnCount; colIndex++) {
        const width = overrideCol == colIndex ? overrideValue : columnWidths?.[colIndex];

        const cssWidth = width
            ? `${width * getTableUnitPxWithoutListening()}px`
            : `${defaultWidth * getTableUnitPxWithoutListening()}px`;
        totalWidth += width || defaultWidth;

        if (!nextDOM) {
            const colElement = document.createElement("col");
            colElement.style.width = cssWidth;
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

    // Always set fixed width

    const finalWidth = Math.max(
        totalWidth,
        contentStyles.blockMaxWidthRem[getPlatformWithoutListening()],
    );
    table.style.width = `${finalWidth * getTableUnitPxWithoutListening()}px`;
}
