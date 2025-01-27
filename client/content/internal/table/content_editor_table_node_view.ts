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
import {resolveContentTableColumnWidthPx} from "~/client/content/internal/table/content_table_column_resizing_plugin.js";
import {getPlatformWithoutListening} from "~/client/remix/platform_context.js";
import {getSpacingScaleWithoutListening} from "~/client/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {
    tableWrapper2ClassName,
    tableWrapper3ClassName,
    tableWrapperClassName,
} from "~/shared/content/content_styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
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

function roundToDevicePx(devicePixelRatio: number, px: number): number {
    return Math.round(px * devicePixelRatio) / devicePixelRatio;
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
        overrideTableAndColumnWidths?.columnWidths ?? ContentTableMap.get(node).columnWidths;

    let totalColumnWidth = 0;
    for (const columnWidth of columnWidths) totalColumnWidth += columnWidth;

    const columnMinWidthPx =
        contentStyles.tableColumnMinWidthRem * remPxBySpacingScale[spacingScale];
    const columnMaxWidthPx = contentStyles.tableColumnMaxWidthPx[spacingScale];

    // The width added to our table for borders. 1px on the left/right added by CSS
    // `padding` and 1px between each column added by CSS `gap`.
    const borderWidthPx = 2 + columnWidths.length - 1;

    const tableMinWidthPx = columnMinWidthPx * columnWidths.length + borderWidthPx;

    const {devicePixelRatio} = window;

    console.log("START");

    // If you delete a column and `tableWidth` doesn't update then we may be left
    // in a situation where `tableWidth` exceeds the max possible width for the
    // table (max possible width being `columnMaxWidthPx * columnWidths.length`).
    //
    // The code below computes the max table width while not allowing any
    // individual column to have a greater width than `columnMaxWidthPx`. It uses
    // an iterative solution where it tries resolving column widths at the max
    // width declared by `tableWidth` (`blockMaxWidth * tableWidth`). If any
    // individual column width is larger than `columnMaxWidthPx` we retry with a
    // smaller max table width.
    //
    // Is there a non-iterative solution where we can figure out
    // `totalColumnMaxWidthPx` in one attempt? Maybe. I haven't thought too deeply.
    // The iterative solution works in 1-2 iterations when `tableWidth` is well
    // formed and ~5 iterations in the edge case we're trying to fix where
    // `tableWidth` is too large.
    //
    // Again, this is a safety measure to get us back in a good state if
    // `tableWidth` is too large. Ideally, all our editing commands update
    // `tableWidth` when necessary. For example, when deleting a column
    // `tableWidth` should shrink. Since ProseMirror can at any time execute
    // arbitrary commands we'll never be able to perfectly control every table
    // update path so we need to be resilient in the face of non-ideal states
    // in our data structure.
    let totalColumnMaxWidthPx: number;
    {
        totalColumnMaxWidthPx = roundToDevicePx(
            devicePixelRatio,
            contentStyles.blockMaxWidthRem[platform] *
                remPxBySpacingScale[spacingScale] *
                tableWidth -
                borderWidthPx,
        );

        let hasNextPass = true;
        while (hasNextPass) {
            hasNextPass = false;

            const resolvedColumnMaxWidthPxs = resolveContentTableColumnWidthPx(
                totalColumnWidth,
                columnWidths,
                totalColumnMaxWidthPx,
                columnMinWidthPx,
            );

            totalColumnMaxWidthPx = 0;
            for (const resolvedColumnMaxWidthPx of resolvedColumnMaxWidthPxs) {
                // `resolvedColumnMaxWidthPx` may never exactly reach `columnMaxWidthPx` due to
                // floating point math. If it never reaches `columnMaxWidthPx` then we'll end
                // up looping forever. So instead wait until `resolvedColumnMaxWidthPx` will
                // round down to `columnMaxWidthPx` in device pixels.
                if (
                    roundToDevicePx(devicePixelRatio, resolvedColumnMaxWidthPx) > columnMaxWidthPx
                ) {
                    hasNextPass = true;
                    totalColumnMaxWidthPx += columnMaxWidthPx;
                } else {
                    totalColumnMaxWidthPx += resolvedColumnMaxWidthPx;
                }
            }

            console.log(resolvedColumnMaxWidthPxs, {
                totalColumnWidth,
                columnWidths,
                totalColumnMaxWidthPx,
            });

            totalColumnMaxWidthPx = roundToDevicePx(devicePixelRatio, totalColumnMaxWidthPx);
        }
    }

    console.log("END");

    const tableMaxWidthPx = totalColumnMaxWidthPx + borderWidthPx;

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
