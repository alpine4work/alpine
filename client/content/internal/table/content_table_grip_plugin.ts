/* eslint-disable @typescript-eslint/unbound-method */
import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {
    getCellsInColumn,
    getCellsInRow,
    isColumnSelected,
    isInContentTable,
    isRowSelected,
    selectColumn,
    selectRow,
    selectTable,
} from "~/client/content/internal/table/content_table_client_util.js";
import {
    addContentTableColumnAfter,
    addRowAfter,
} from "~/client/content/internal/table/content_table_commands.js";
import {contentStyles} from "~/client/styles/styles.js";

// NOCOMMIT: update the names of the grips, all of them seems confusing
// because of similar functionalities.
export const contentTableGripPlugin = ({isEditable}: {isEditable: boolean}): Plugin => {
    let view: EditorView | null;

    const plugin = new Plugin({
        key: new PluginKey("contentTableGrip"),
        view: editorView => {
            view = editorView;
            return {
                destroy() {
                    view = null;
                },
            };
        },
        props: {
            decorations: state => {
                if (!isEditable) {
                    return DecorationSet.empty;
                }

                const {doc, selection} = state;
                const decorations: Array<Decoration> = [];
                if (isInContentTable(state)) {
                    // Get the first cell position which will be at the start of the table
                    const rowCells = getCellsInColumn(0)(selection);
                    if (rowCells?.[0]) {
                        decorations.push(
                            Decoration.widget(rowCells[0].pos, () => {
                                const button = document.createElement("a");
                                button.className = contentStyles.gripTableClassName;
                                button.title = "Select table";
                                button.addEventListener("mousedown", event => {
                                    event.preventDefault();
                                    event.stopImmediatePropagation();
                                    if (view) {
                                        const tr = view.state.tr;
                                        view.dispatch(selectTable(tr));
                                    }
                                });
                                return button;
                            }),
                        );
                    }
                }

                // Handle row grips
                const rowCells = getCellsInColumn(0)(selection);
                if (rowCells) {
                    rowCells.forEach(({pos}: {pos: number}, index: number) => {
                        decorations.push(
                            Decoration.widget(pos + 1, () => {
                                const rowSelected = isRowSelected(index)(selection);
                                let className = contentStyles.gripRowClassName;

                                if (rowSelected) {
                                    className += " selected";
                                }
                                if (index === 0) {
                                    className += " first";
                                }
                                if (index === rowCells.length - 1) {
                                    className += " last";
                                }

                                const grip = document.createElement("a");
                                grip.className = className;
                                grip.addEventListener("mousedown", event => {
                                    event.preventDefault();
                                    event.stopImmediatePropagation();
                                    if (view) {
                                        view.dispatch(selectRow(index)(view.state.tr));
                                    }
                                });
                                return grip;
                            }),
                        );
                    });

                    // Add row button after last row
                    if (rowCells.length > 0) {
                        const lastCell = rowCells[rowCells.length - 1];
                        if (lastCell) {
                            // Calculate position after all rows
                            const lastCellNode = state.doc.nodeAt(lastCell.pos);
                            const addButtonPos = lastCell.pos + (lastCellNode?.nodeSize || 0);

                            decorations.push(
                                Decoration.widget(addButtonPos, () => {
                                    const addRowGrip = document.createElement("div");
                                    addRowGrip.className = contentStyles.tableAddRowGripClassName;
                                    addRowGrip.innerHTML = "+";
                                    addRowGrip.title = "Add row";

                                    addRowGrip.addEventListener("mousedown", event => {
                                        event.preventDefault();
                                        event.stopImmediatePropagation();
                                        if (view) {
                                            // Add row at the very end
                                            addRowAfter(view.state, view.dispatch);
                                            // After adding, select the new last row
                                            const newRowCells = getCellsInColumn(0)(
                                                view.state.selection,
                                            );
                                            if (newRowCells) {
                                                const lastRowIndex = newRowCells.length - 1;
                                                view.dispatch(
                                                    selectRow(lastRowIndex)(view.state.tr),
                                                );
                                            }
                                        }
                                    });

                                    return addRowGrip;
                                }),
                            );
                        }
                    }
                }

                // Handle column grips
                const colCells = getCellsInRow(0)(selection);
                if (colCells) {
                    colCells.forEach(({pos}: {pos: number}, index: number) => {
                        decorations.push(
                            Decoration.widget(pos + 1, () => {
                                const colSelected = isColumnSelected(index)(selection);
                                let className = contentStyles.gripColumnClassName;

                                if (colSelected) {
                                    className += " selected";
                                }
                                if (index === 0) {
                                    className += " first";
                                }
                                if (index === colCells.length - 1) {
                                    className += " last";
                                }

                                const grip = document.createElement("a");
                                grip.className = className;
                                grip.addEventListener("mousedown", event => {
                                    event.preventDefault();
                                    event.stopImmediatePropagation();
                                    if (view) {
                                        view.dispatch(selectColumn(index)(view.state.tr));
                                    }
                                });
                                return grip;
                            }),
                        );
                    });

                    // Add column button after last column
                    if (colCells.length > 0) {
                        const lastCell = colCells[colCells.length - 1];
                        if (lastCell) {
                            // Calculate position after all columns
                            const lastCellNode = state.doc.nodeAt(lastCell.pos);
                            const addButtonPos = lastCell.pos + (lastCellNode?.nodeSize || 0);

                            decorations.push(
                                Decoration.widget(addButtonPos, () => {
                                    const addColumnGrip = document.createElement("div");
                                    addColumnGrip.className =
                                        contentStyles.tableAddColumnGripClassName;
                                    addColumnGrip.style.right = "-24px"; // Position it outside the table
                                    addColumnGrip.style.left = "auto"; // Reset any left positioning
                                    addColumnGrip.innerHTML = "+";
                                    addColumnGrip.title = "Add column";

                                    // Move the click handler to the grip itself
                                    addColumnGrip.addEventListener("mousedown", event => {
                                        event.preventDefault();
                                        event.stopImmediatePropagation();
                                        if (view) {
                                            // Add column at the very end
                                            addContentTableColumnAfter(view.state, view.dispatch);
                                            // After adding, select the new last column
                                            const newColCells = getCellsInRow(0)(
                                                view.state.selection,
                                            );
                                            if (newColCells) {
                                                const lastColumnIndex = newColCells.length - 1;
                                                view.dispatch(
                                                    selectColumn(lastColumnIndex)(view.state.tr),
                                                );
                                            }
                                        }
                                    });

                                    return addColumnGrip;
                                }),
                            );
                        }
                    }
                }

                return DecorationSet.create(doc, decorations);
            },
        },
    });
    return plugin;
};
