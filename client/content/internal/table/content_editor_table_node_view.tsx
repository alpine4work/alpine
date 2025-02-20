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
import {resolveContentTableColumnWidthPx} from "~/client/content/internal/table/content_editor_table_plugin.js";
import {
    isInContentTable,
    selectedContentTableRect,
} from "~/client/content/internal/table/content_table_client_util.js";
import {
    addContentTableColumnAfterSelection,
    addContentTableColumnBeforeSelection,
    addContentTableRowAfterSelection,
    addContentTableRowBeforeSelection,
    deleteContentTable,
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
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Rectangle} from "~/shared/helpers/geometry/rectangle.js";

export function createContentEditorTableNodeView(): NodeViewConstructor {
    return (node, view, getPos) => {
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
            let selectedTableRect = isInContentTable(view.state)
                ? selectedContentTableRect(view.state)
                : null;

            // The selection is in a table but not our table.
            if (selectedTableRect !== null && selectedTableRect.tablePos - 1 !== getPos()) {
                selectedTableRect = null;
            }

            // Right click is considered in our table if:
            //
            // - We're right clicking into a `<td>` element. The selection will be moved
            //   inside this element if it's not there already; OR
            //
            // - The selection is currently in the table. This will happen if your
            //   selection is in the table but you right click on a column resize handle.
            //   The selection doesn't move and instead stays in the table.
            if (!((event.target as HTMLElement).closest("td") || selectedTableRect !== null))
                return;

            addContextMenuActions(event, [
                [
                    {
                        label: "Add row after",
                        iconPlacement: "end",
                        icon: <RowsPlusBottomIcon />,
                        onPress: () => {
                            addContentTableRowAfterSelection(view.state, view.dispatch);
                        },
                    },
                    {
                        label: "Add row before",
                        iconPlacement: "end",
                        icon: <RowsPlusTopIcon />,
                        onPress: () => {
                            addContentTableRowBeforeSelection(view.state, view.dispatch);
                        },
                    },
                ],
                [
                    {
                        label: "Add column after",
                        iconPlacement: "end",
                        icon: <ColumnsPlusRightIcon style={{transform: "translateX(0.0625rem)"}} />,
                        onPress: () => {
                            addContentTableColumnAfterSelection(view.state, view.dispatch);
                        },
                    },
                    {
                        label: "Add column before",
                        iconPlacement: "end",
                        icon: <ColumnsPlusLeftIcon style={{transform: "translateX(-0.125rem)"}} />,
                        onPress: () => {
                            addContentTableColumnBeforeSelection(view.state, view.dispatch);
                        },
                    },
                ],
                [
                    {
                        label:
                            selectedTableRect !== null &&
                            selectedTableRect.bottom - selectedTableRect.top > 1
                                ? `Delete ${selectedTableRect.bottom - selectedTableRect.top} rows`
                                : "Delete row",
                        iconPlacement: "end",
                        icon: <Trash />,
                        onPress: () => {
                            deleteContentTableRow(view.state, view.dispatch);
                        },
                    },
                    {
                        label:
                            selectedTableRect !== null &&
                            selectedTableRect.right - selectedTableRect.left > 1
                                ? `Delete ${
                                      selectedTableRect.right - selectedTableRect.left
                                  } columns`
                                : "Delete column",
                        iconPlacement: "end",
                        icon: <Trash />,
                        onPress: () => {
                            deleteContentTableColumn(view.state, view.dispatch);
                        },
                    },
                    {
                        label: "Delete table",
                        iconPlacement: "end",
                        icon: <Trash />,
                        onPress: () => {
                            deleteContentTable(view.state, view.dispatch);
                        },
                    },
                ],
            ]);

            // HACK: If our table has a cell selection then ProseMirror represents the
            // selection in the DOM as a selection against only the bottom right `<td>`
            // element. In Chrome if the user right clicks in the bottom right `<td>`
            // element then the selection will be kept in place. However, if the user right
            // clicks in another cell in the selection then Chrome sets the selection to
            // the text the user right clicked on!
            //
            // We don't like this browser default behavior. Instead, if the user right
            // clicks within a table cell selection then we want the cell selection to not
            // change. That way a user can delete multiple rows or multiple columns at
            // once. Since we can't find the right event to call `event.preventDefault()`
            // on to prevent the browser's default behavior we do the following:
            //
            // If the user right clicks into _this_ table's cell selection (we that the
            // right click falls within the cell selection element's bounds) then for up to
            // two animation frames check to see if the selection has changed from our
            // previous cell selection. If the selection has changed then set the selection
            // back to our cell selection. By checking on animation frames we guarantee the
            // user will never see a flicker of the browser setting a different text
            // selection.
            if (
                view.state.selection instanceof ContentTableCellSelection &&
                view.state.selection.tablePos - 1 === getPos()
            ) {
                const tableCellSelectionElement = tableElement.querySelector(
                    `.${contentStyles.tableCellSelectionClassName}`,
                );

                if (
                    tableCellSelectionElement &&
                    Rectangle.from(tableCellSelectionElement.getBoundingClientRect()).containsPoint(
                        {x: event.clientX, y: event.clientY},
                    )
                ) {
                    const oldDoc = view.state.doc;
                    const oldSelection = view.state.selection;

                    requestAnimationFrame(() => {
                        if (view.state.doc === oldDoc && !view.state.selection.eq(oldSelection)) {
                            view.dispatch(view.state.tr.setSelection(oldSelection));
                        }

                        requestAnimationFrame(() => {
                            if (
                                view.state.doc === oldDoc &&
                                !view.state.selection.eq(oldSelection)
                            ) {
                                view.dispatch(view.state.tr.setSelection(oldSelection));
                            }
                        });
                    });
                }
            }
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
    // `blockWidthPx * tableWidth + tableOverflowGradientWidthPx * 2`. This
    // calculation leaves us with the right width.
    tableWrapper3Element.style.width = `round(nearest, ${100 * tableWidth}% - ${-(
        tableOverflowGradientWidthPx *
        2 *
        (1 - tableWidth)
    )}px, 1px)`;

    tableWrapper3Element.style.minWidth = `${
        totalColumnMinWidthPx + tableOverflowGradientWidthPx * 2
    }px`;

    tableWrapper3Element.style.maxWidth = `${
        Math.min(
            contentStyles.blockMaxWidthRem[platform] *
                tableWidth *
                remPxBySpacingScale[spacingScale],
            totalColumnMaxWidthPx,
        ) +
        tableOverflowGradientWidthPx * 2
    }px`;

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
