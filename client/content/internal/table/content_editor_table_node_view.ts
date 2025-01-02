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
import {NodeViewConstructor} from "prosemirror-view";
import {getContentTableColumnWidths} from "~/client/content/internal/table/content_table_client_util.js";
import {getPlatformWithoutListening} from "~/client/remix/platform_context.js";
import {
    getSpacingScaleWithoutListening,
    subscribeToSpacingScaleChange,
} from "~/client/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {tableWrapperClassName} from "~/shared/content/content_styles.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";

export function createContentEditorTableNodeView({
    subscribeToSelectionUpdate,
}: {
    subscribeToSelectionUpdate: (listener: () => void) => () => void;
}): NodeViewConstructor {
    return node => {
        const tableWrapperElement = document.createElement("div");
        tableWrapperElement.className = tableWrapperClassName;
        tableWrapperElement.setAttribute("data-scrollbar", "false");

        const tableElement = tableWrapperElement.appendChild(document.createElement("table"));

        updateContentTableColumnsOnResize(node, tableElement);

        const tableBodyElement = tableElement.appendChild(document.createElement("tbody"));

        addActiveTableClass();

        // Subscribe to spacing scale changes. This also covers all platform changes so
        // we don't need to also subscribe to platform changes.
        const unsubscribeFromSpacingScaleChange = subscribeToSpacingScaleChange(() => {
            updateContentTableColumnsOnResize(node, tableElement);
        });

        const unsubscribeFromSelectionUpdate = subscribeToSelectionUpdate(() => {
            // TODO(calebmer): Why do we need `requestAnimationFrame()` here?
            requestAnimationFrame(addActiveTableClass);
        });

        function addActiveTableClass() {}

        return {
            dom: tableWrapperElement,
            contentDOM: tableBodyElement,

            update: newNode => {
                if (newNode.type != node.type) return false;
                node = newNode;
                updateContentTableColumnsOnResize(node, tableElement);
                return true;
            },
            ignoreMutation: record => {
                return record.type == "attributes" && record.target === tableElement;
            },
            destroy: () => {
                unsubscribeFromSpacingScaleChange();
                unsubscribeFromSelectionUpdate();
            },
        };
    };
}

export function updateContentTableColumnsOnResize(
    node: Node,
    tableElement: HTMLTableElement,
    overrideTableAndColumnWidths?: {
        readonly tableWidth: number;
        readonly columnWidths: ReadonlyArray<number>;
        readonly scrollTo?: "left" | "right";
    },
): void {
    const platform = getPlatformWithoutListening();
    const spacingScale = getSpacingScaleWithoutListening();
    const tableWidth: number = Math.max(
        1,
        overrideTableAndColumnWidths?.tableWidth ?? node.attrs.tableWidth ?? 1,
    );
    const columnWidths =
        overrideTableAndColumnWidths?.columnWidths ?? getContentTableColumnWidths(node);

    const columnMinWidthPx =
        contentStyles.tableColumnMinWidthRem * remPxBySpacingScale[spacingScale];

    // NOCOMMIT: Can I do some rounding here to avoid fractional pixels?

    // The width added to our table for borders. 1px on the left/right added by CSS
    // `padding` and 1px between each column added by CSS `gap`.
    const borderWidthPx = 2 + columnWidths.length - 1;

    const minWidthPx = columnMinWidthPx * columnWidths.length + borderWidthPx;
    const maxWidthPx =
        contentStyles.tableColumnMaxWidthPx[spacingScale] * columnWidths.length + borderWidthPx;

    tableElement.style.minWidth = `${minWidthPx}px`;
    tableElement.style.width = `${tableWidth * 100}%`;
    tableElement.style.maxWidth = `min(${
        contentStyles.blockMaxWidthRem[platform] * tableWidth
    }rem, ${maxWidthPx}px)`;

    tableElement.style.gridTemplateColumns = columnWidths
        .map(columnWidth => `minmax(${columnMinWidthPx}px, ${columnWidth}fr)`)
        .join(" ");

    // While resizing we may need to make sure scroll is locked to the left/right
    // side. For example when dragging to grow the rightmost edge.
    if (overrideTableAndColumnWidths?.scrollTo !== undefined) {
        const tableWrapperElement = tableElement.parentElement!;

        if (overrideTableAndColumnWidths.scrollTo === "left") {
            tableWrapperElement.scrollLeft = 0;
        }

        if (overrideTableAndColumnWidths.scrollTo === "right") {
            tableWrapperElement.scrollLeft =
                tableWrapperElement.scrollWidth - tableWrapperElement.clientWidth;
        }
    }
}
