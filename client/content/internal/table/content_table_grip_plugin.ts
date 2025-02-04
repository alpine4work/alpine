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
import {dotsSixIconSvg} from "~/client/icons/dots_six_icon_svg.js";
import {dotsSixVerticalIconSvg} from "~/client/icons/dots_six_vertical_icon_svg.js";
import {plusIconSvg} from "~/client/icons/plus_icon_svg.js";
import {contentStyles} from "~/client/styles/styles.js";
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
            pressClassName: contentStyles.tableGripButtonPressedClassName,
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
                view.dispatch(selectRow(rowIndex)(view.state.tr));
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
            // We use on press start since it looks weird to have a pressed state adjacent
            // next to a selected state. Better to immediately move the selection. It's
            // also not a big a deal if the user cancels their press.
            onPressStart: event => {
                event.preventDefault();

                assert(view);

                view.dispatch(selectColumn(columnIndex)(view.state.tr));
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
                        class: contentStyles.tableWithSelectionClassName,
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
};
