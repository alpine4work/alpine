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
import {dispatchContentEditorFileRowTableParentUpdatedEvent} from "~/client/content/internal/content_editor_file_row_like_node_view.js";
import {subscribeToOptimisticContentEditableTableLayoutEvent} from "~/client/content/state/table/content_editor_table_plugin.js";
import {
    isInContentTable,
    selectedContentTableRect,
} from "~/client/content/state/table/content_table_client_util.js";
import {
    addContentTableColumnAfterSelection,
    addContentTableColumnBeforeSelection,
    addContentTableRowAfterSelection,
    addContentTableRowBeforeSelection,
    deleteContentTable,
    deleteContentTableColumn,
    deleteContentTableRow,
    toggleContentTableHeaderColumn,
    toggleContentTableHeaderRow,
} from "~/client/content/state/table/content_table_commands.js";
import {
    ContentEditorTableLayout,
    resolveContentTableColumnWidthPx,
} from "~/client/content/state/table/helpers/resolve_content_table_column_width_px.js";
import {addContextMenuActions} from "~/client/design/context_menu.js";
import {ColumnsPlusLeftIcon} from "~/client/icons/columns_plus_left_icon.js";
import {ColumnsPlusRightIcon} from "~/client/icons/columns_plus_right_icon.js";
import {RowsPlusBottomIcon} from "~/client/icons/rows_plus_bottom_icon.js";
import {RowsPlusTopIcon} from "~/client/icons/rows_plus_top_icon.js";
import {subscribeToPlatformChange} from "~/client/remix/platform_context.js";
import {
    getSpacingScaleWithoutListening,
    subscribeToSpacingScaleChange,
} from "~/client/remix/spacing_scale_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {ContentTableCellSelection} from "~/shared/content/table/content_table_cell_selection.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {
    fileClassName,
    fileRowLikeClassName,
    tableWrapper2ClassName,
    tableWrapper3ClassName,
    tableWrapperClassName,
} from "~/shared/design/core/constant_class_names.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {Rectangle} from "~/shared/helpers/geometry/rectangle.js";

export function createContentEditorTableNodeView({
    getBlockWidth,
    getAccessLevel,
}: {
    getBlockWidth: () => number;
    getAccessLevel: () => AccessLevel;
}): NodeViewConstructor {
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
        if (node.attrs.hasHeaderRow) {
            tableElement.classList.add(contentStyles.tableWithHeaderRowClassName);
        }

        if (node.attrs.hasHeaderColumn) {
            tableElement.classList.add(contentStyles.tableWithHeaderColumnClassName);
        }
        const tableBodyElement = document.createElement("tbody");
        tableElement.appendChild(tableBodyElement);

        tableElement.addEventListener("contextmenu", handleContextMenu);

        let optimisticTableLayout: ContentEditorTableLayout | null = null;
        let fileRowLikeElementsCache: {node: Node; elements: Array<HTMLElement>} | null = null;

        updateTableLayout();

        const unsubscribeFromPlatformChange = subscribeToPlatformChange(updateTableLayout);
        const unsubscribeFromSpacingScaleChange = subscribeToSpacingScaleChange(updateTableLayout);

        const unsubscribeFromOptimisticLayout =
            subscribeToOptimisticContentEditableTableLayoutEvent(tableElement, layout => {
                optimisticTableLayout = layout;

                updateTableLayout();

                // While resizing we may need to make sure scroll is locked to the left/right
                // side. For example when dragging to grow the rightmost edge.
                if (layout.scrollLeftPx !== undefined) {
                    const tableWrapper2Element = tableWrapper3Element.parentElement!;
                    tableWrapper2Element.scrollLeft = layout.scrollLeftPx;
                }

                // It's safe to `querySelectorAll()` here since ProseMirror should have
                // rendered all children to the DOM by this point.
                if (fileRowLikeElementsCache === null || fileRowLikeElementsCache.node !== node) {
                    fileRowLikeElementsCache = {
                        node,
                        elements: Array.from(
                            // Find all elements with the provided class names and exclude elements that
                            // are children of a file node. File entities may recursively render content
                            // (e.g. document file entities). The content within file entities is inert
                            // so shouldn't get any interactive behaviors.
                            tableBodyElement.querySelectorAll(
                                `.${fileRowLikeClassName}:not(.${fileClassName} .${fileRowLikeClassName})`,
                            ),
                        ),
                    };
                }

                // NOTE(calebmer, 2025-04-03): Admittedly, the way we handle updating file
                // layouts when the optimistic table layout changes is messy. Inside the table
                // node view we have our `optimisticTableLayout` state. Then we dispatch events
                // to all children `fileRow`s with the expectation that they'll update their
                // own internal `optimisticTableLayout` states. Then the `fileRow` should
                // dispatch an event to its `file` child which has its own internal
                // `optimisticTableLayout` state. Ideally, there'd be some way for `fileRow`
                // and `file` to reach into `table`'s internal node view state.
                for (const fileRowLikeElement of fileRowLikeElementsCache.elements) {
                    dispatchContentEditorFileRowTableParentUpdatedEvent(
                        fileRowLikeElement,
                        optimisticTableLayout,
                    );
                }
            });

        return {
            dom: tableWrapperElement,
            contentDOM: tableBodyElement,

            update: newNode => {
                if (newNode.type != node.type) return false;

                if (newNode.attrs.hasHeaderRow !== node.attrs.hasHeaderRow) {
                    if (newNode.attrs.hasHeaderRow) {
                        tableElement.classList.add(contentStyles.tableWithHeaderRowClassName);
                    } else {
                        tableElement.classList.remove(contentStyles.tableWithHeaderRowClassName);
                    }
                }

                // Check if the hasHeaderColumn attribute has changed
                if (newNode.attrs.hasHeaderColumn !== node.attrs.hasHeaderColumn) {
                    if (newNode.attrs.hasHeaderColumn) {
                        tableElement.classList.add(contentStyles.tableWithHeaderColumnClassName);
                    } else {
                        tableElement.classList.remove(contentStyles.tableWithHeaderColumnClassName);
                    }
                }

                const hasLayoutChanged =
                    node.attrs.columnWidths !== newNode.attrs.columnWidths ||
                    node.attrs.tableWidth !== newNode.attrs.tableWidth;

                // Clear the optimistic table layout if the `columnWidths` or `tableWidth`
                // attrs changed.
                if (hasLayoutChanged) {
                    optimisticTableLayout = null;
                }

                node = newNode;
                updateTableLayout();

                if (hasLayoutChanged) {
                    // Dispatch child events after a microtask since ProseMirror updates parent
                    // nodes before child nodes. We want to wait until ProseMirror has finished
                    // updating before we notify our children they need to change.
                    scheduleMicrotask(() => {
                        // It's safe to `querySelectorAll()` here since ProseMirror should have
                        // rendered all children to the DOM by this point.
                        //
                        // It's NOT safe to `querySelectorAll()` directly in the `update` function
                        // since ProseMirror renders parents to the DOM before children. So if the
                        // update is adding or removing file nodes we need to wait a microtask to see
                        // them in the DOM.
                        if (
                            fileRowLikeElementsCache === null ||
                            fileRowLikeElementsCache.node !== node
                        ) {
                            fileRowLikeElementsCache = {
                                node,
                                elements: Array.from(
                                    // Find all elements with the provided class names and exclude elements that
                                    // are children of a file node. File entities may recursively render content
                                    // (e.g. document file entities). The content within file entities is inert
                                    // so shouldn't get any interactive behaviors.
                                    tableBodyElement.querySelectorAll(
                                        `.${fileRowLikeClassName}:not(.${fileClassName} .${fileRowLikeClassName})`,
                                    ),
                                ),
                            };
                        }

                        for (const fileRowLikeElement of fileRowLikeElementsCache.elements) {
                            dispatchContentEditorFileRowTableParentUpdatedEvent(
                                fileRowLikeElement,
                                optimisticTableLayout,
                            );
                        }
                    });
                }

                return true;
            },
            destroy: () => {
                unsubscribeFromPlatformChange();
                unsubscribeFromSpacingScaleChange();
                unsubscribeFromOptimisticLayout();
            },
            ignoreMutation: record => {
                return (
                    record.type === "attributes" &&
                    (record.target === tableElement || record.target === tableWrapper3Element)
                );
            },
        };

        function updateTableLayout(): void {
            const spacingScale = getSpacingScaleWithoutListening();
            const {devicePixelRatio} = window;

            const blockWidthPx = getBlockWidth();

            const tableWrapper3Element = tableElement.parentElement!;

            const tableMap = ContentTableMap.get(node);
            const tableLayout = optimisticTableLayout ?? tableMap;

            const columnWidthPxs = resolveContentTableColumnWidthPx(
                spacingScale,
                blockWidthPx,
                tableLayout,
            );

            let totalColumnWidthPx = 0;

            for (let i = 0; i < columnWidthPxs.length; i++) {
                const columnWidthPx = roundToDevicePx(devicePixelRatio, columnWidthPxs[i]!);
                columnWidthPxs[i] = columnWidthPx;
                totalColumnWidthPx += columnWidthPx;
            }

            const tableOverflowGradientWidthPx = convertRemLengthToPx(
                contentStyles.tableOverflowGradientWidth,
                spacingScale,
            );

            tableWrapper3Element.style.width = `${
                totalColumnWidthPx + tableOverflowGradientWidthPx * 2
            }px`;
            tableWrapper3Element.style.maxWidth = "none";

            tableElement.style.gridTemplateColumns = columnWidthPxs
                .map(columnWidthPx => `${columnWidthPx}px`)
                .join(" ");
        }

        function handleContextMenu(event: MouseEvent) {
            if (!hasAccessLevel(getAccessLevel(), "Edit")) return;

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
                        label: "Add row",
                        icon: <RowsPlusBottomIcon />,
                        iconPlacement: "end",
                        onPress: () => {
                            addContentTableRowAfterSelection(view.state, view.dispatch);
                        },
                    },
                    {
                        label: "Add column",
                        icon: <ColumnsPlusRightIcon style={{transform: "translateX(0.0625rem)"}} />,
                        iconPlacement: "end",
                        onPress: () => {
                            addContentTableColumnAfterSelection(view.state, view.dispatch);
                        },
                    },
                    {
                        label:
                            selectedTableRect !== null &&
                            selectedTableRect.bottom - selectedTableRect.top > 1
                                ? `Delete ${selectedTableRect.bottom - selectedTableRect.top} rows`
                                : "Delete row",
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
                        onPress: () => {
                            deleteContentTableColumn(view.state, view.dispatch);
                        },
                    },
                    {
                        hasChildren: true,
                        key: "table-more",
                        label: "More",
                        actions: [
                            [
                                {
                                    label: node.attrs.hasHeaderRow
                                        ? "Remove header row"
                                        : "Add header row",
                                    iconPlacement: "end",
                                    onPress: () => {
                                        toggleContentTableHeaderRow(getPos()!)(
                                            view.state,
                                            view.dispatch,
                                        );
                                    },
                                },
                                {
                                    label: node.attrs.hasHeaderColumn
                                        ? "Remove header column"
                                        : "Add header column",
                                    onPress: () => {
                                        toggleContentTableHeaderColumn(getPos()!)(
                                            view.state,
                                            view.dispatch,
                                        );
                                    },
                                },
                            ],
                            [
                                {
                                    label: "Add row above",
                                    icon: <RowsPlusTopIcon />,
                                    iconPlacement: "end",
                                    onPress: () => {
                                        addContentTableRowBeforeSelection(
                                            view.state,
                                            view.dispatch,
                                        );
                                    },
                                },
                                {
                                    label: "Add row below",
                                    icon: <RowsPlusBottomIcon />,
                                    iconPlacement: "end",
                                    onPress: () => {
                                        addContentTableRowAfterSelection(view.state, view.dispatch);
                                    },
                                },
                            ],
                            [
                                {
                                    label: "Add column to left",
                                    icon: (
                                        <ColumnsPlusLeftIcon
                                            style={{transform: "translateX(-0.125rem)"}}
                                        />
                                    ),
                                    iconPlacement: "end",
                                    onPress: () => {
                                        addContentTableColumnBeforeSelection(
                                            view.state,
                                            view.dispatch,
                                        );
                                    },
                                },
                                {
                                    label: "Add column to right",
                                    icon: (
                                        <ColumnsPlusRightIcon
                                            style={{transform: "translateX(0.0625rem)"}}
                                        />
                                    ),
                                    iconPlacement: "end",
                                    onPress: () => {
                                        addContentTableColumnAfterSelection(
                                            view.state,
                                            view.dispatch,
                                        );
                                    },
                                },
                            ],
                            [
                                {
                                    label: "Delete table",
                                    onPress: () => {
                                        deleteContentTable(view.state, view.dispatch);
                                    },
                                },
                            ],
                        ],
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
                        {
                            x: event.clientX,
                            y: event.clientY,
                        },
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
        }
    };
}

function roundToDevicePx(devicePixelRatio: number, px: number): number {
    return Math.round(px * devicePixelRatio) / devicePixelRatio;
}
