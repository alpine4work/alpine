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

import {Trash} from "phosphor-react";
import {Node} from "prosemirror-model";
import {NodeViewConstructor} from "prosemirror-view";
import {resolveContentTableColumnWidthPx} from "~/client/content/internal/table/content_table_column_resizing_plugin.js";
import {
    addContentTableColumnAfterSelection,
    addContentTableColumnBeforeSelection,
    addContentTableRowAfterSelection,
    addContentTableRowBeforeSelection,
    deleteContentTableColumn,
    deleteContentTableRow,
} from "~/client/content/internal/table/content_table_commands.js";
import {addContextMenuActions} from "~/client/design/context_menu.js";
import {ColumnsPlusLeftIcon} from "~/client/icons/columns_plus_left_icon.js";
import {ColumnsPlusRightIcon} from "~/client/icons/columns_plus_right_icon.js";
import {RowsPlusBottomIcon} from "~/client/icons/rows_plus_bottom_icon.js";
import {RowsPlusTopIcon} from "~/client/icons/rows_plus_top_icon.js";
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
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";

export function createContentEditorTableNodeView(): NodeViewConstructor {
    return (node, view) => {
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

        tableElement.addEventListener("contextmenu", event => {
            // Right click must be in table data cell.
            if (!(event.target as HTMLElement).closest("td")) return;

            addContextMenuActions(event, [
                [
                    {
                        label: "Add row before",
                        iconPlacement: "end",
                        icon: <RowsPlusTopIcon />,
                        onPress: () => {
                            addContentTableRowBeforeSelection(view.state, view.dispatch);
                        },
                    },
                    {
                        label: "Add row after",
                        iconPlacement: "end",
                        icon: <RowsPlusBottomIcon />,
                        onPress: () => {
                            addContentTableRowAfterSelection(view.state, view.dispatch);
                        },
                    },
                    {
                        label: "Delete row",
                        iconPlacement: "end",
                        icon: <Trash />,
                        onPress: () => {
                            deleteContentTableRow(view.state, view.dispatch);
                        },
                    },
                ],
                [
                    {
                        label: "Add column before",
                        iconPlacement: "end",
                        icon: <ColumnsPlusLeftIcon style={{transform: "translateX(-0.125rem)"}} />,
                        onPress: () => {
                            addContentTableColumnBeforeSelection(view.state, view.dispatch);
                        },
                    },
                    {
                        label: "Add column after",
                        iconPlacement: "end",
                        icon: <ColumnsPlusRightIcon style={{transform: "translateX(0.0625rem)"}} />,
                        onPress: () => {
                            addContentTableColumnAfterSelection(view.state, view.dispatch);
                        },
                    },
                    {
                        label: "Delete column",
                        iconPlacement: "end",
                        icon: <Trash />,
                        onPress: () => {
                            deleteContentTableColumn(view.state, view.dispatch);
                        },
                    },
                ],
            ]);
        });

        // Subscribe to spacing scale changes. This also covers all platform changes so
        // we don't need to also subscribe to platform changes.
        const unsubscribeFromSpacingScaleChange = subscribeToSpacingScaleChange(() => {
            updateContentTableColumnsOnResize(node, tableElement);
        });

        return {
            dom: tableWrapperElement,
            contentDOM: tableBodyElement,

            update: newNode => {
                if (newNode.type != node.type) return false;

                node = newNode;
                updateContentTableColumnsOnResize(node, tableElement);

                // `update()` is called when the decorations on the table change.
                // `contentTableGripPlugin()` will add the
                // `contentStyles.tableWrapperWithSelectionClassName` CSS class which adds
                // extra padding for table grips. We don't want this extra padding to change
                // the scroll position as seen by the user so detect when
                // `contentStyles.tableWrapperWithSelectionClassName` is added/removed and
                // adjust the scroll position when that happens.
                {
                    const oldTableOffsetLeft = tableElement.offsetLeft;
                    const oldWithSelection = tableWrapperElement.classList.contains(
                        contentStyles.tableWrapperWithSelectionClassName,
                    );

                    scheduleMicrotask(() => {
                        const newWithSelection = tableWrapperElement.classList.contains(
                            contentStyles.tableWrapperWithSelectionClassName,
                        );

                        if (oldWithSelection !== newWithSelection) {
                            const newTableOffsetLeft = tableElement.offsetLeft;

                            tableWrapper2Element.scrollLeft +=
                                newTableOffsetLeft - oldTableOffsetLeft;
                        }
                    });
                }

                return true;
            },
            ignoreMutation: record => {
                return (
                    record.type == "attributes" &&
                    (record.target === tableElement || record.target === tableWrapper3Element)
                );
            },
            destroy: () => {
                unsubscribeFromSpacingScaleChange();
            },
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
        scrollLeftPx?: number;
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
    const columnMaxWidthPx =
        contentStyles.tableColumnMaxWidthRem * remPxBySpacingScale[spacingScale];

    const totalColumnMinWidthPx = columnMinWidthPx * columnWidths.length;

    const {devicePixelRatio} = window;
    const columnMaxWidthPxRoundedToDevicePx = roundToDevicePx(devicePixelRatio, columnMaxWidthPx);

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
    // `tableMaxWidthPx` in one attempt? Maybe. I haven't thought too deeply.
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
    let resolvedColumnMaxWidthPxsRoundedToDevicePx: Array<number>;
    {
        totalColumnMaxWidthPx = roundToDevicePx(
            devicePixelRatio,
            contentStyles.blockMaxWidthRem[platform] *
                remPxBySpacingScale[spacingScale] *
                tableWidth,
        );

        let hasNextPass = true;
        while (hasNextPass) {
            hasNextPass = false;

            resolvedColumnMaxWidthPxsRoundedToDevicePx = resolveContentTableColumnWidthPx(
                totalColumnWidth,
                columnWidths,
                totalColumnMaxWidthPx,
                columnMinWidthPx,
            );

            const previousTotalColumnMaxWidthPx = totalColumnMaxWidthPx;
            totalColumnMaxWidthPx = 0;
            for (let i = 0; i < resolvedColumnMaxWidthPxsRoundedToDevicePx.length; i++) {
                const resolvedColumnMaxWidthPxRoundedToDevicePx = roundToDevicePx(
                    devicePixelRatio,
                    resolvedColumnMaxWidthPxsRoundedToDevicePx[i]!,
                );
                resolvedColumnMaxWidthPxsRoundedToDevicePx[i] =
                    resolvedColumnMaxWidthPxRoundedToDevicePx;

                // `resolvedColumnMaxWidthPxRoundedToDevicePx` may never exactly reach
                // `columnMaxWidthPx` due to floating point math. If it never reaches
                // `columnMaxWidthPx` then we'll end up looping forever. So instead wait until
                // `resolvedColumnMaxWidthPxRoundedToDevicePx` will round down to
                // `columnMaxWidthPx` in device pixels.
                if (resolvedColumnMaxWidthPxRoundedToDevicePx > columnMaxWidthPxRoundedToDevicePx) {
                    hasNextPass = true;
                    totalColumnMaxWidthPx += columnMaxWidthPx;
                } else {
                    totalColumnMaxWidthPx += resolvedColumnMaxWidthPxRoundedToDevicePx;
                }
            }

            totalColumnMaxWidthPx = roundToDevicePx(devicePixelRatio, totalColumnMaxWidthPx);

            if (hasNextPass) {
                // If we need another pass, `totalColumnMaxWidthPx` should be less than
                // `previousTotalColumnMaxWidthPx`. We keep shrinking `totalColumnMaxWidthPx`
                // until no column violates our maximum width.
                assert(totalColumnMaxWidthPx <= previousTotalColumnMaxWidthPx);

                // Protect against infinite looping: If `totalColumnMaxWidthPx` doesn't change
                // it means we're going to get stuck in an infinite loop as each iteration will
                // produce the same `totalColumnMaxWidthPx` which fails our `columnMaxWidthPx`
                // check.
                //
                // If we hit this branch it's likely a symptom of something else being broken.
                if (previousTotalColumnMaxWidthPx === totalColumnMaxWidthPx) {
                    hasNextPass = false;
                }
            }
        }
    }

    const tableOverflowGradientWidthPx = convertRemLengthToPx(
        contentStyles.tableOverflowGradientWidth,
        spacingScale,
    );

    // 100% width includes the overflow gradient width (because of our parent's
    // negative margin). So the CSS `${100 * tableWidth}%` would give us the size
    // `(blockWidthPx + tableOverflowGradientWidthPx * 2) * tableWidth`. What we
    // actually want is width to be
    // `blockWidthPx * tableWidth + tableInnerPaddingXVar`. So first we calculate
    // `blockWidthPx * tableWidth + tableOverflowGradientWidthPx * 2` with
    // `100% * tableWidth - tableOverflowGradientWidthPx * 2 * (1 - tableWidth)`
    // to remove the extra pixels from the multiplied 100%. Then we add
    // `tableInnerPaddingXVar - tableOverflowGradientWidthPx` to get the
    // remaining pixel difference. This calculation finally leaves us with the
    // right width.
    tableWrapper3Element.style.width = `round(nearest, ${100 * tableWidth}% - ${-(
        tableOverflowGradientWidthPx *
        2 *
        (1 - tableWidth)
    )}px + ((${
        contentStyles.tableInnerPaddingXVar
    } - ${tableOverflowGradientWidthPx}px) * 2), 1px)`;

    tableWrapper3Element.style.minWidth = `calc(${totalColumnMinWidthPx}px + (${contentStyles.tableInnerPaddingXVar} * 2))`;

    tableWrapper3Element.style.maxWidth = `calc(${Math.min(
        contentStyles.blockMaxWidthRem[platform] * tableWidth * remPxBySpacingScale[spacingScale],
        totalColumnMaxWidthPx,
    )}px + (${contentStyles.tableInnerPaddingXVar} * 2))`;

    // Instead of setting the column fr units to `columnWidths`, we set the column
    // fr units to the resolved column max width rounded to device pixels. When the
    // table is at the block max width (e.g. on desktop but not mobile) the fr
    // value should exactly equal the column px values. By using fr units the
    // columns will still shrink on mobile.
    //
    // Using `columnWidths` would be more correct in theory, but we ran into
    // strange browser behavior in practice. See [this StackOverflow issue][1]. We
    // were able to workaround the issue by giving the browser clean, rounded,
    // values instead of floats requiring 17 places of precision.
    //
    // [1]: https://stackoverflow.com/questions/79397471/css-grid-incorrectly-constrains-column-width-when-min-width-css-is-present
    tableElement.style.gridTemplateColumns = resolvedColumnMaxWidthPxsRoundedToDevicePx!
        .map(
            resolvedColumnMaxWidthPxRoundedToDevicePx =>
                `minmax(${columnMinWidthPx}px, ${resolvedColumnMaxWidthPxRoundedToDevicePx}fr)`,
        )
        .join(" ");

    // While resizing we may need to make sure scroll is locked to the left/right
    // side. For example when dragging to grow the rightmost edge.
    if (overrideTableAndColumnWidths?.scrollLeftPx !== undefined) {
        const tableWrapper2Element = tableWrapper3Element.parentElement!;
        tableWrapper2Element.scrollLeft = overrideTableAndColumnWidths.scrollLeftPx;
    }
}
