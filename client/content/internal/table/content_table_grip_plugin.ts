import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {
    getCellsInColumn,
    getCellsInRow,
    isColumnSelected,
    isRowSelected,
    selectColumn,
    selectRow,
} from "~/client/content/internal/table/content_table_client_util.js";
import {contentStyles} from "~/client/styles/styles.js";

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
                }

                return DecorationSet.create(doc, decorations);
            },
        },
    });
    return plugin;
};
