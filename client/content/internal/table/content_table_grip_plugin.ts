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
import {
    addContentTableColumnAtIndex,
    addContentTableRowAtIndex,
} from "~/client/content/internal/table/content_table_commands.js";
import {colorSchemeVars, contentStyles} from "~/client/styles/styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";

// NOCOMMIT: update the names of the grips, all of them seems confusing
// because of similar functionalities.
export const contentTableGripPlugin = ({isEditable}: {isEditable: boolean}): Plugin => {
    let view: EditorView | null;

    const lazyGripButtonElementLazy = new Lazy(() => {
        const gripButtonElement = document.createElement("div");
        gripButtonElement.className = contentStyles.tableGripButtonClassName;

        addUnfocusableButtonBehaviorToElement(gripButtonElement, {
            onPress: event => {
                event.preventDefault();
                assert(view);
                view.dispatch(selectTable(view.state.tr));
            },
        });

        return gripButtonElement;
    });

    const lazyBetweenRowGripElementByIndex = new LazyMap((rowIndex: number) => {
        const betweenRowGripElement = document.createElement("div");
        betweenRowGripElement.className = contentStyles.tableBetweenRowGripClassName;

        const plusSign = document.createElement("span");
        plusSign.innerHTML = "+";
        plusSign.style.display = "none";
        plusSign.style.color = colorSchemeVars["grey-100"];
        betweenRowGripElement.appendChild(plusSign);

        addUnfocusableButtonBehaviorToElement(betweenRowGripElement, {
            onPress: event => {
                event.preventDefault();

                assert(view);

                const $cell = selectionContentTableCell(view.state);
                const tablePos = $cell.start(-1);

                addContentTableRowAtIndex(tablePos, rowIndex + 1)(view.state, view.dispatch);
            },
        });

        return betweenRowGripElement;
    });

    const lazyGripRowElementByIndex = new LazyMap((rowIndex: number) => {
        const gripRowElement = document.createElement("a");
        gripRowElement.className = contentStyles.tableGripRowClassName;

        if (rowIndex === 0) {
            gripRowElement.classList.add(contentStyles.tableGripFirstRowClassName);
        }

        addUnfocusableButtonBehaviorToElement(gripRowElement, {
            onPress: event => {
                event.preventDefault();
                assert(view);
                view.dispatch(selectRow(rowIndex)(view.state.tr));
            },
        });

        return gripRowElement;
    });

    const lazyAddRowGripElement = new Lazy(() => {
        const addRowGripElement = document.createElement("div");
        addRowGripElement.className = contentStyles.tableAddRowGripClassName;
        addRowGripElement.innerHTML = "+";

        addUnfocusableButtonBehaviorToElement(addRowGripElement, {
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

    const lazyBetweenColumnGripElementByIndex = new LazyMap((columnIndex: number) => {
        const betweenColumnGripElement = document.createElement("div");
        betweenColumnGripElement.className = contentStyles.tableBetweenColumnGripClassName;

        const plusSign = document.createElement("span");
        plusSign.innerHTML = "+";
        plusSign.style.display = "none";
        plusSign.style.color = colorSchemeVars["grey-100"];
        betweenColumnGripElement.appendChild(plusSign);

        addUnfocusableButtonBehaviorToElement(betweenColumnGripElement, {
            onPress: event => {
                event.preventDefault();

                assert(view);

                const $cell = selectionContentTableCell(view.state);
                const tablePos = $cell.start(-1);

                addContentTableColumnAtIndex(tablePos, columnIndex + 1)(view.state, view.dispatch);
            },
        });

        return betweenColumnGripElement;
    });

    const lazyGripColumnElementByIndex = new LazyMap((columnIndex: number) => {
        const gripColumnElement = document.createElement("a");
        gripColumnElement.className = contentStyles.tableGripColumnClassName;

        if (columnIndex === 0) {
            gripColumnElement.classList.add(contentStyles.tableGripFirstColumnClassName);
        }

        addUnfocusableButtonBehaviorToElement(gripColumnElement, {
            onPress: event => {
                event.preventDefault();

                assert(view);

                view.dispatch(selectColumn(columnIndex)(view.state.tr));
            },
        });

        return gripColumnElement;
    });

    const lazyAddColumnGripElement = new Lazy(() => {
        const addColumnGripElement = document.createElement("div");
        addColumnGripElement.className = contentStyles.tableAddColumnGripClassName;
        addColumnGripElement.innerHTML = "+";

        addUnfocusableButtonBehaviorToElement(addColumnGripElement, {
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
                    Decoration.widget(tablePos + 1, () => {
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

                let nextRelativeRowPos = 0;
                for (let rowIndex = 0; rowIndex < tableMap.height; rowIndex++) {
                    const row = table.content.content[rowIndex]!;
                    const rowPos = tablePos + nextRelativeRowPos;
                    nextRelativeRowPos += row.nodeSize;

                    if (rowIndex < tableMap.height - 1) {
                        decorations.push(
                            Decoration.widget(rowPos + 2, () => {
                                return lazyBetweenRowGripElementByIndex.get(rowIndex);
                            }),
                        );
                    }

                    decorations.push(
                        Decoration.widget(rowPos + 2, () => {
                            const gripRowElement = lazyGripRowElementByIndex.get(rowIndex);

                            if (isRowSelected(rowIndex)(selection)) {
                                gripRowElement.classList.add(
                                    contentStyles.tableGripSelectedRowClassName,
                                );
                            } else {
                                gripRowElement.classList.remove(
                                    contentStyles.tableGripSelectedRowClassName,
                                );
                            }

                            if (rowIndex === tableMap.height - 1) {
                                gripRowElement.classList.add(
                                    contentStyles.tableGripLastRowClassName,
                                );
                            } else {
                                gripRowElement.classList.remove(
                                    contentStyles.tableGripLastRowClassName,
                                );
                            }

                            return gripRowElement;
                        }),
                    );

                    if (rowIndex === tableMap.height - 1) {
                        decorations.push(
                            Decoration.widget(rowPos + 1 + row.content.content[0]!.nodeSize, () => {
                                return lazyAddRowGripElement.get();
                            }),
                        );
                    }
                }

                const firstRow = table.content.content[0]!;
                let nextRelativeCellPos = 1;
                for (let columnIndex = 0; columnIndex < tableMap.width; columnIndex++) {
                    const cell = firstRow.content.content[columnIndex]!;
                    const cellPos = tablePos + nextRelativeCellPos;
                    nextRelativeCellPos += cell.nodeSize;

                    // Add between column grip for all columns except last
                    if (columnIndex < tableMap.width - 1) {
                        decorations.push(
                            Decoration.widget(cellPos + 1, () => {
                                return lazyBetweenColumnGripElementByIndex.get(columnIndex);
                            }),
                        );
                    }

                    decorations.push(
                        Decoration.widget(cellPos + 1, () => {
                            const gripColumnElement = lazyGripColumnElementByIndex.get(columnIndex);

                            if (isColumnSelected(columnIndex)(selection)) {
                                gripColumnElement.classList.add(
                                    contentStyles.tableGripSelectedColumnClassName,
                                );
                            } else {
                                gripColumnElement.classList.remove(
                                    contentStyles.tableGripSelectedColumnClassName,
                                );
                            }

                            if (columnIndex === tableMap.width - 1) {
                                gripColumnElement.classList.add(
                                    contentStyles.tableGripLastColumnClassName,
                                );
                            } else {
                                gripColumnElement.classList.remove(
                                    contentStyles.tableGripLastColumnClassName,
                                );
                            }

                            return gripColumnElement;
                        }),
                    );

                    // Add column button after last column
                    if (columnIndex === tableMap.width - 1) {
                        decorations.push(
                            Decoration.widget(cellPos + cell.nodeSize, () => {
                                return lazyAddColumnGripElement.get();
                            }),
                        );
                    }
                }

                return DecorationSet.create(doc, decorations);
            },
        },
    });
    return plugin;
};
