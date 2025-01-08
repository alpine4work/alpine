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
import {
    tableWrapper2ClassName,
    tableWrapper3ClassName,
    tableWrapperClassName,
} from "~/shared/content/content_styles.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";

export function createContentEditorTableNodeView(): NodeViewConstructor {
    return node => {
        const tableWrapperElement = document.createElement("div");
        tableWrapperElement.className = tableWrapperClassName;

        const tableWrapper2Element = document.createElement("div");
        tableWrapperElement.appendChild(tableWrapper2Element);
        tableWrapper2Element.className = tableWrapper2ClassName;
        tableWrapper2Element.setAttribute("data-scrollbar", "false");

        const tableWrapper3Element = document.createElement("div");
        tableWrapper2Element.appendChild(tableWrapper3Element);
        tableWrapper3Element.className = tableWrapper3ClassName;

        const tableElement = document.createElement("table");
        tableWrapper3Element.appendChild(tableElement);

        updateContentTableColumnsOnResize(node, tableElement);

        const tableBodyElement = document.createElement("tbody");
        tableElement.appendChild(tableBodyElement);

        // Subscribe to spacing scale changes. This also covers all platform changes so
        // we don't need to also subscribe to platform changes.

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
                return (
                    record.type == "attributes" &&
                    (record.target === tableElement || record.target === tableWrapper3Element)
                );
            },
            destroy: () => {},
        };
    };
}

export function updateContentTableColumnsOnResize(
    node: Node,
    tableElement: HTMLTableElement,
    overrideTableAndColumnWidths?: {
        tableWidth?: number;
        columnWidths: ReadonlyArray<number>;
        scrollTo?: "left" | "right";
    },
): void {
    const platform = getPlatformWithoutListening();
    const spacingScale = getSpacingScaleWithoutListening();

    const tableWrapper3Element = tableElement.parentElement!;

    const tableWidth: number = Math.max(
        1,
        overrideTableAndColumnWidths?.tableWidth ?? node.attrs.tableWidth ?? 1,
    );
    const columnWidths =
        overrideTableAndColumnWidths?.columnWidths ?? getContentTableColumnWidths(node);

    const columnMinWidthPx =
        contentStyles.tableColumnMinWidthRem * remPxBySpacingScale[spacingScale];

    // The width added to our table for borders. 1px on the left/right added by CSS
    // `padding` and 1px between each column added by CSS `gap`.
    const borderWidthPx = 2 + columnWidths.length - 1;

    const tableMinWidthPx = columnMinWidthPx * columnWidths.length + borderWidthPx;
    const tableMaxWidthPx =
        contentStyles.tableColumnMaxWidthPx[spacingScale] * columnWidths.length + borderWidthPx;

    const tableInnerPaddingXDoubledPx =
        convertRemLengthToPx(contentStyles.tableInnerPaddingX, spacingScale) * 2;

    // 100% width includes the inner padding (because of our parent's negative margin).
    // So the CSS `${100 * tableWidth}%` would give us the size
    // `(blockWidthPx + tableInnerPaddingXDoubledPx) * tableWidth`. What we actually
    // want is width to be `blockWidthPx * tableWidth + tableInnerPaddingXDoubledPx`.
    // So subtract some pixels to get us to the right width.
    tableWrapper3Element.style.width = `round(nearest, ${100 * tableWidth}% - ${-(
        tableInnerPaddingXDoubledPx *
        (1 - tableWidth)
    )}px, 1px)`;

    tableWrapper3Element.style.minWidth = `${tableInnerPaddingXDoubledPx + tableMinWidthPx}px`;

    tableWrapper3Element.style.maxWidth = `${
        tableInnerPaddingXDoubledPx +
        Math.max(
            tableInnerPaddingXDoubledPx,
            Math.min(
                contentStyles.blockMaxWidthRem[platform] *
                    tableWidth *
                    remPxBySpacingScale[spacingScale],
                tableMaxWidthPx,
            ),
        )
    }px`;

    tableElement.style.gridTemplateColumns = columnWidths
        .map(columnWidth => `minmax(${columnMinWidthPx}px, ${columnWidth}fr)`)
        .join(" ");

    // While resizing we may need to make sure scroll is locked to the left/right
    // side. For example when dragging to grow the rightmost edge.
    if (overrideTableAndColumnWidths?.scrollTo !== undefined) {
        const tableWrapper2Element = tableWrapper3Element.parentElement!;

        if (overrideTableAndColumnWidths.scrollTo === "left") {
            tableWrapper2Element.scrollLeft = 0;
        }

        if (overrideTableAndColumnWidths.scrollTo === "right") {
            tableWrapper2Element.scrollLeft =
                tableWrapper2Element.scrollWidth - tableWrapper2Element.clientWidth;
        }
    }
}
