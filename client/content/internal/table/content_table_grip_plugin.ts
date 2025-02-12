import {Fragment, Node as ProseMirrorNode} from "prosemirror-model";
import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {addUnfocusableButtonBehaviorToElement} from "~/client/content/internal/helpers/add_unfocusable_button_behavior_to_element.js";
import {
    isColumnSelected,
    isInContentTable,
    isRowSelected,
    isTableSelected,
    selectColumn,
    selectRow,
    selectTable,
    selectionContentTableCell,
} from "~/client/content/internal/table/content_table_client_util.js";
import {contentTableColumnDragPluginKey} from "~/client/content/internal/table/content_table_column_drag_plugin.js";
import {
    addContentTableColumnAtIndex,
    addContentTableRowAtIndex,
} from "~/client/content/internal/table/content_table_commands.js";
import {
    DraggableType,
    getDraggableDataFromEvent,
} from "~/client/content/internal/table/content_table_get_draggable_event_data.js";
import {contentTableRowDragPluginKey} from "~/client/content/internal/table/content_table_row_drag_plugin.js";
import {dotsSixIconSvg} from "~/client/icons/dots_six_icon_svg.js";
import {dotsSixVerticalIconSvg} from "~/client/icons/dots_six_vertical_icon_svg.js";
import {plusIconSvg} from "~/client/icons/plus_icon_svg.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";

// NOCOMMIT: update the names of the grips, all of them seems confusing
// because of similar functionalities.
export function contentTableGripPlugin({isEditable}: {isEditable: boolean}): Plugin {
    let view: EditorView | null;
    let dragCover: HTMLElement | null = null;

    const lazyGripButtonElementLazy = new Lazy(() => {
        const gripButtonElement = document.createElement("div");
        gripButtonElement.className = contentStyles.tableGripButtonClassName;

        addUnfocusableButtonBehaviorToElement(gripButtonElement, {
            // We use on press start since it looks weird to have a pressed state adjacent
            // next to a selected state. Better to immediately move the selection. It's
            // also not a big a deal if the user cancels their press.
            onPressStart: event => {
                event.preventDefault();
                assert(view);
                view.dispatch(selectTable(view.state.tr));
            },
        });

        return gripButtonElement;
    });

    const lazyBetweenRowGripElementByIndex = new LazyMap((rowIndex: number) => {
        const betweenRowGripElement = document.createElement("div");
        betweenRowGripElement.className = `${contentStyles.tableBetweenGripClassName} ${contentStyles.tableBetweenRowGripClassName}`;
        betweenRowGripElement.style.gridRow = `${rowIndex + 1}`;

        const betweenRowGripButtonElement = document.createElement("div");
        betweenRowGripElement.appendChild(betweenRowGripButtonElement);
        betweenRowGripButtonElement.className = contentStyles.tableBetweenGripButtonClassName;

        betweenRowGripButtonElement.innerHTML = plusIconSvg({weight: "bold"});

        addUnfocusableButtonBehaviorToElement(betweenRowGripElement, {
            hoverClassName: contentStyles.tableBetweenGripHoveredClassName,
            pressClassName: contentStyles.tableBetweenGripPressedClassName,
            onPress: event => {
                event.preventDefault();

                assert(view);

                const $cell = selectionContentTableCell(view.state);
                const tablePos = $cell.start(-1);

                addContentTableRowAtIndex(tablePos, rowIndex)(view.state, view.dispatch);
            },
        });

        return betweenRowGripElement;
    });

    const lazyBetweenColumnGripElementByIndex = new LazyMap((columnIndex: number) => {
        const betweenColumnGripElement = document.createElement("div");
        betweenColumnGripElement.className = `${contentStyles.tableBetweenGripClassName} ${contentStyles.tableBetweenColumnGripClassName}`;
        betweenColumnGripElement.style.gridColumn = `${columnIndex + 1}`;

        const betweenColumnGripButtonElement = document.createElement("div");
        betweenColumnGripElement.appendChild(betweenColumnGripButtonElement);
        betweenColumnGripButtonElement.className = contentStyles.tableBetweenGripButtonClassName;

        betweenColumnGripButtonElement.innerHTML = plusIconSvg({weight: "bold"});

        addUnfocusableButtonBehaviorToElement(betweenColumnGripElement, {
            hoverClassName: contentStyles.tableBetweenGripHoveredClassName,
            pressClassName: contentStyles.tableBetweenGripPressedClassName,
            onPress: event => {
                event.preventDefault();

                assert(view);

                const $cell = selectionContentTableCell(view.state);
                const tablePos = $cell.start(-1);

                addContentTableColumnAtIndex(tablePos, columnIndex)(view.state, view.dispatch);
            },
        });

        return betweenColumnGripElement;
    });

    const lazyGripRowElementByIndex = new LazyMap((rowIndex: number) => {
        const gripRowElement = document.createElement("div");
        gripRowElement.className = `${contentStyles.tableGripClassName} ${contentStyles.tableGripRowClassName}`;
        gripRowElement.style.gridRow = `${rowIndex + 1} / ${rowIndex + 2}`;

        gripRowElement.innerHTML = dotsSixVerticalIconSvg();

        if (rowIndex === 0) {
            gripRowElement.classList.add(contentStyles.tableGripFirstClassName);
        }

        addUnfocusableButtonBehaviorToElement(gripRowElement, {
            hoverClassName: contentStyles.tableGripHoveredClassName,
            // We use on press start since it looks weird to have a pressed state adjacent
            // next to a selected state. Better to immediately move the selection. It's
            // also not a big a deal if the user cancels their press.
            onPressStart: event => {
                event.preventDefault();
                assert(view);

                // Create drag cover
                dragCover = document.createElement("div");
                dragCover.className = sprinkles({
                    position: "fixed",
                    inset: "0",
                    zIndex: "70",
                    cursor: "grabbing",
                });
                document.body.appendChild(dragCover);

                // Set initial state
                view.dispatch(
                    view.state.tr
                        .setMeta(contentTableRowDragPluginKey, {
                            type: "StartDrag",
                            startY: event.clientY,
                            rowIndex: rowIndex,
                            gripElement: gripRowElement,
                        })
                        .setSelection(selectRow(rowIndex)(view.state.tr).selection),
                );

                // Trigger for showing the lines on the edge of any row drag
                const handlePointerMove = (moveEvent: PointerEvent) => {
                    assert(view);
                    const state = contentTableRowDragPluginKey.getState(view.state);
                    assert(state?.dragging);

                    const draggableData = getDraggableDataFromEvent(
                        moveEvent,
                        view,
                        DraggableType.TABLE_ROW,
                    );
                    assert(draggableData);

                    const newRowIndex = draggableData.targetAdjustedIndex;
                    if (newRowIndex === state.dragging.currentRowIndex) return;
                    view.dispatch(
                        view.state.tr.setMeta(contentTableRowDragPluginKey, {
                            type: "UpdateDrag",
                            currentRowIndex: newRowIndex,
                        }),
                    );
                };

                // Setup pointer up handler
                const handlePointerUp = () => {
                    assert(view);

                    const state = contentTableRowDragPluginKey.getState(view.state);
                    assert(state?.dragging);

                    if (state.dragging.startRowIndex !== state.dragging.currentRowIndex) {
                        const $cell = selectionContentTableCell(view.state);
                        const table = $cell.node(-1);
                        const tableStart = $cell.start(-1);
                        const map = ContentTableMap.get(table);

                        const tr = view.state.tr;
                        const fromIndex = state.dragging.startRowIndex;
                        const toIndex = state.dragging.currentRowIndex;

                        // Move cells logic
                        const cellsToMove: Array<{
                            pos: number;
                            node: ProseMirrorNode;
                            nodeSize: number;
                            content: Fragment;
                        }> = [];

                        // Collect all cells in the row
                        for (let col = 0; col < map.width; col++) {
                            const fromPos = map.positionAt(fromIndex, col, table);
                            const cell = table.nodeAt(fromPos);
                            if (!cell) continue;
                            cellsToMove.push({
                                pos: tableStart + fromPos,
                                node: cell,
                                nodeSize: cell.nodeSize,
                                content: cell.content,
                            });
                        }

                        // Move cells
                        const processCells = (cells: typeof cellsToMove) => {
                            cells.forEach((cell, idx) => {
                                const col = fromIndex < toIndex ? map.width - 1 - idx : idx;
                                const toPos = map.positionAt(toIndex, col, table);
                                tr.delete(cell.pos, cell.pos + cell.nodeSize);
                                const tableCellType = table.type.schema.nodes.tableCell;
                                assert(tableCellType);
                                const newCell = tableCellType.create(null, cell.content);
                                tr.insert(tableStart + toPos, newCell);
                            });
                        };

                        processCells(
                            fromIndex < toIndex ? [...cellsToMove].reverse() : cellsToMove,
                        );

                        try {
                            view.dispatch(tr);
                        } catch (error) {
                            assert(error instanceof Error);
                            view.dispatch(
                                view.state.tr.setMeta(contentTableColumnDragPluginKey, {
                                    type: "EndDrag",
                                }),
                            );
                        }
                    }

                    // Cleanup
                    gripRowElement.style.transform = "";
                    document.removeEventListener("pointermove", handlePointerMove);
                    document.removeEventListener("pointerup", handlePointerUp);
                    if (dragCover) {
                        dragCover.remove();
                        dragCover = null;
                    }

                    view.dispatch(
                        view.state.tr.setMeta(contentTableRowDragPluginKey, {
                            type: "EndDrag",
                        }),
                    );
                };

                // Add document-level event listeners
                document.addEventListener("pointermove", handlePointerMove);
                document.addEventListener("pointerup", handlePointerUp);
            },
        });

        return gripRowElement;
    });

    const lazyGripColumnElementByIndex = new LazyMap((columnIndex: number) => {
        const gripColumnElement = document.createElement("div");
        gripColumnElement.className = `${contentStyles.tableGripClassName} ${contentStyles.tableGripColumnClassName}`;
        gripColumnElement.style.gridColumn = `${columnIndex + 1} / ${columnIndex + 2}`;

        gripColumnElement.innerHTML = dotsSixIconSvg();

        if (columnIndex === 0) {
            gripColumnElement.classList.add(contentStyles.tableGripFirstClassName);
        }

        addUnfocusableButtonBehaviorToElement(gripColumnElement, {
            hoverClassName: contentStyles.tableGripHoveredClassName,
            onPressStart: event => {
                event.preventDefault();
                assert(view);

                const $cell = selectionContentTableCell(view.state);
                const tablePos = $cell.start(-1);

                let tableElement: HTMLTableElement | null = null;
                {
                    let element: globalThis.Node | null = view.domAtPos(tablePos).node;
                    while (element && element.nodeName != "TABLE") element = element.parentNode;

                    tableElement = element as HTMLTableElement | null;
                }
                assert(tableElement instanceof HTMLElement);

                const columnRect = getColumnRect(tableElement, columnIndex);

                // Create drag cover
                dragCover = document.createElement("div");
                dragCover.className = sprinkles({
                    position: "fixed",
                    inset: "0",
                    zIndex: "70",
                    cursor: "grabbing",
                });
                document.body.appendChild(dragCover);

                // Set initial state
                view.dispatch(
                    view.state.tr
                        .setMeta(contentTableColumnDragPluginKey, {
                            type: "StartDrag",
                            startX: event.clientX,
                            columnIndex: columnIndex,
                            gripElement: gripColumnElement,
                            closestEdge: null,
                            mouseX: event.clientX,
                            mouseY: event.clientY,
                            previewRect: columnRect,
                        })
                        .setSelection(selectColumn(columnIndex)(view.state.tr).selection),
                );

                // NOCOMMIT: Check the logic for this as the lines are updating incorrectly
                //          there is some problem in the getDataFromEvent function
                // Trigger for showing the lines on the edge of any column drag
                // this is a hack to show the lines on the edge of any column drag
                const handlePointerMove = (moveEvent: PointerEvent) => {
                    assert(view);
                    const draggableData = getDraggableDataFromEvent(
                        moveEvent,
                        view,
                        DraggableType.TABLE_COLUMN,
                    );
                    assert(draggableData);

                    const state = contentTableColumnDragPluginKey.getState(view.state);
                    assert(state?.dragging);

                    const newColumnIndex = draggableData.targetAdjustedIndex;
                    if (newColumnIndex === state.dragging.currentColumnIndex) return;

                    view.dispatch(
                        view.state.tr.setMeta(contentTableColumnDragPluginKey, {
                            type: "UpdateDrag",
                            currentColumnIndex: newColumnIndex,
                            closestEdge: draggableData.targetClosestEdge,
                        }),
                    );
                };

                // Logic for applying changes for column drag.
                const handlePointerUp = () => {
                    assert(view);
                    const state = contentTableColumnDragPluginKey.getState(view.state);
                    assert(state?.dragging);

                    if (state.dragging.startColumnIndex !== state.dragging.currentColumnIndex) {
                        const $cell = selectionContentTableCell(view.state);
                        const table = $cell.node(-1);
                        const tableStart = $cell.start(-1);
                        const map = ContentTableMap.get(table);

                        const tr = view.state.tr;
                        const fromIndex = state.dragging.startColumnIndex;
                        const toIndex = state.dragging.currentColumnIndex;

                        // Move cells logic
                        const cellsToMove: Array<{
                            pos: number;
                            node: ProseMirrorNode;
                            nodeSize: number;
                            content: Fragment;
                        }> = [];
                        for (let row = 0; row < map.height; row++) {
                            const fromPos = map.positionAt(row, fromIndex, table);
                            const cell = table.nodeAt(fromPos);
                            if (!cell) continue;
                            cellsToMove.push({
                                pos: tableStart + fromPos,
                                node: cell,
                                nodeSize: cell.nodeSize,
                                content: cell.content,
                            });
                        }

                        // Update column widths
                        const columnWidths = [...table.attrs.columnWidths];
                        const [movedWidth] = columnWidths.splice(fromIndex, 1);
                        columnWidths.splice(toIndex, 0, movedWidth);
                        tr.setNodeAttribute(tableStart - 1, "columnWidths", columnWidths);

                        // Move cells
                        const processCells = (cells: typeof cellsToMove) => {
                            cells.forEach((cell, idx) => {
                                const row = fromIndex < toIndex ? map.height - 1 - idx : idx;
                                const toPos = map.positionAt(row, toIndex, table);
                                tr.delete(cell.pos, cell.pos + cell.nodeSize);
                                const tableCellType = table.type.schema.nodes.tableCell;
                                assert(tableCellType);
                                const newCell = tableCellType.create(null, cell.content);
                                tr.insert(tableStart + toPos, newCell);
                            });
                        };

                        processCells(
                            fromIndex < toIndex ? [...cellsToMove].reverse() : cellsToMove,
                        );

                        try {
                            view.dispatch(tr);
                        } catch (error) {
                            assert(error instanceof Error);
                            view.dispatch(
                                view.state.tr.setMeta(contentTableColumnDragPluginKey, {
                                    type: "EndDrag",
                                }),
                            );
                        }
                    }

                    // Cleanup
                    document.removeEventListener("pointermove", handlePointerMove);
                    document.removeEventListener("pointerup", handlePointerUp);
                    if (dragCover) {
                        dragCover.remove();
                        dragCover = null;
                    }

                    view.dispatch(
                        view.state.tr.setMeta(contentTableColumnDragPluginKey, {
                            type: "EndDrag",
                        }),
                    );
                };

                // Add document-level event listeners
                document.addEventListener("pointermove", handlePointerMove);
                document.addEventListener("pointerup", handlePointerUp);
            },
        });

        return gripColumnElement;
    });

    const lazyAddRowGripElement = new Lazy(() => {
        const addRowGripElement = document.createElement("div");
        addRowGripElement.className = `${contentStyles.tableAddGripClassName} ${contentStyles.tableAddRowGripClassName}`;
        addRowGripElement.innerHTML = plusIconSvg();

        addUnfocusableButtonBehaviorToElement(addRowGripElement, {
            pressClassName: contentStyles.tableAddGripPressedClassName,
            onPress: event => {
                event.preventDefault();

                assert(view);

                const $cell = selectionContentTableCell(view.state);
                const tablePos = $cell.start(-1);
                const table = $cell.node(-1);
                const tableMap = ContentTableMap.get(table);

                addContentTableRowAtIndex(tablePos, tableMap.height)(view.state, view.dispatch);
            },
        });

        return addRowGripElement;
    });

    const lazyAddColumnGripElement = new Lazy(() => {
        const addColumnGripElement = document.createElement("div");
        addColumnGripElement.className = `${contentStyles.tableAddGripClassName} ${contentStyles.tableAddColumnGripClassName}`;
        addColumnGripElement.innerHTML = plusIconSvg();

        addUnfocusableButtonBehaviorToElement(addColumnGripElement, {
            pressClassName: contentStyles.tableAddGripPressedClassName,
            onPress: event => {
                event.preventDefault();

                assert(view);

                const $cell = selectionContentTableCell(view.state);
                const tablePos = $cell.start(-1);
                const table = $cell.node(-1);
                const tableMap = ContentTableMap.get(table);

                addContentTableColumnAtIndex(tablePos, tableMap.width)(view.state, view.dispatch);
            },
        });

        return addColumnGripElement;
    });

    const plugin = new Plugin({
        key: new PluginKey("contentTableGrip"),
        view: editorView => {
            view = editorView;
            return {
                destroy() {
                    if (dragCover) {
                        dragCover.remove();
                        dragCover = null;
                    }
                    view = null;
                },
            };
        },
        props: {
            decorations: state => {
                if (!isEditable || !isInContentTable(state)) {
                    return DecorationSet.empty;
                }

                const {doc, selection} = state;
                const decorations: Array<Decoration> = [];

                const $cell = selectionContentTableCell(state);
                const tablePos = $cell.start(-1);
                const table = $cell.node(-1);
                const tableMap = ContentTableMap.get(table);

                decorations.push(
                    Decoration.node(tablePos - 1, tablePos - 1 + table.nodeSize, {
                        class: contentStyles.tableWrapperWithSelectionClassName,
                    }),
                );

                decorations.push(
                    Decoration.widget(tablePos, () => {
                        const gripButtonElement = lazyGripButtonElementLazy.get();

                        if (isTableSelected(selection)) {
                            gripButtonElement.classList.add(
                                contentStyles.tableGripButtonSelectedClassName,
                            );
                        } else {
                            gripButtonElement.classList.remove(
                                contentStyles.tableGripButtonSelectedClassName,
                            );
                        }

                        return gripButtonElement;
                    }),
                );

                for (let rowIndex = 0; rowIndex < tableMap.height; rowIndex++) {
                    decorations.push(
                        Decoration.widget(tablePos, () => {
                            return lazyBetweenRowGripElementByIndex.get(rowIndex);
                        }),
                    );

                    decorations.push(
                        Decoration.widget(tablePos, () => {
                            const gripRowElement = lazyGripRowElementByIndex.get(rowIndex);

                            if (isRowSelected(rowIndex)(selection)) {
                                gripRowElement.classList.add(
                                    contentStyles.tableGripSelectedClassName,
                                );
                            } else {
                                gripRowElement.classList.remove(
                                    contentStyles.tableGripSelectedClassName,
                                );
                            }

                            if (rowIndex === tableMap.height - 1) {
                                gripRowElement.classList.add(contentStyles.tableGripLastClassName);
                            } else {
                                gripRowElement.classList.remove(
                                    contentStyles.tableGripLastClassName,
                                );
                            }

                            return gripRowElement;
                        }),
                    );
                }

                decorations.push(
                    Decoration.widget(tablePos, () => {
                        return lazyBetweenRowGripElementByIndex.get(tableMap.height);
                    }),
                );

                decorations.push(
                    Decoration.widget(tablePos, () => {
                        return lazyAddRowGripElement.get();
                    }),
                );

                for (let columnIndex = 0; columnIndex < tableMap.width; columnIndex++) {
                    decorations.push(
                        Decoration.widget(tablePos, () => {
                            return lazyBetweenColumnGripElementByIndex.get(columnIndex);
                        }),
                    );

                    decorations.push(
                        Decoration.widget(tablePos, () => {
                            const gripColumnElement = lazyGripColumnElementByIndex.get(columnIndex);

                            if (isColumnSelected(columnIndex)(selection)) {
                                gripColumnElement.classList.add(
                                    contentStyles.tableGripSelectedClassName,
                                );
                            } else {
                                gripColumnElement.classList.remove(
                                    contentStyles.tableGripSelectedClassName,
                                );
                            }

                            if (columnIndex === tableMap.width - 1) {
                                gripColumnElement.classList.add(
                                    contentStyles.tableGripLastClassName,
                                );
                            } else {
                                gripColumnElement.classList.remove(
                                    contentStyles.tableGripLastClassName,
                                );
                            }

                            return gripColumnElement;
                        }),
                    );
                }

                decorations.push(
                    Decoration.widget(tablePos, () => {
                        return lazyBetweenColumnGripElementByIndex.get(tableMap.width);
                    }),
                );

                decorations.push(
                    Decoration.widget(tablePos, () => {
                        return lazyAddColumnGripElement.get();
                    }),
                );

                return DecorationSet.create(doc, decorations);
            },
        },
    });
    return plugin;
}
/**
 * function calculates the bounding rectangle for a specific column in an HTML table.
 * @param tableElement - The table element
 * @param columnIndex - The index of the column
 * @returns The rect of the column
 */
function getColumnRect(tableElement: HTMLElement, columnIndex: number): DOMRect {
    // Selects all <td> (table cell) elements that are in the specified column.
    // nth-child(${columnIndex + 1}) selects the (columnIndex + 1)-th child
    // because nth-child is one-based.
    const cells = tableElement.querySelectorAll(`td:nth-child(${columnIndex + 1})`);
    let left = Infinity,
        right = -Infinity,
        top = Infinity,
        bottom = -Infinity;

    cells.forEach(cell => {
        const rect = cell.getBoundingClientRect();
        left = Math.min(left, rect.left);
        right = Math.max(right, rect.right);
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
    });

    return new DOMRect(left, top, right - left, bottom - top);
}
