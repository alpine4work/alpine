import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {
    getCellsInColumn,
    isInContentTable,
} from "~/client/content/internal/table/content_table_client_util.js";

type ContentTableRowDragState = {
    dragging: {
        startY: number;
        startRowIndex: number;
        currentRowIndex: number;
        gripElement: HTMLElement | null;
    } | null;
    dropTargetIndex: number;
    decorationSet: DecorationSet;
};

export const contentTableRowDragPluginKey = new PluginKey<ContentTableRowDragState>(
    "contentTableRowDrag",
);

export const contentTableRowDragPlugin = (): Plugin => {
    let view: EditorView | null;
    let dragCover: HTMLElement | null = null;

    return new Plugin({
        key: contentTableRowDragPluginKey,
        state: {
            init(): ContentTableRowDragState {
                return {
                    dragging: null,
                    dropTargetIndex: 0,
                    decorationSet: DecorationSet.empty,
                };
            },
            apply(tr, value, oldState, newState) {
                const action = tr.getMeta(contentTableRowDragPluginKey);
                if (!action) return value;

                switch (action.type) {
                    case "StartDrag":
                        return {
                            ...value,
                            dragging: {
                                startY: action.startY,
                                startRowIndex: action.rowIndex,
                                currentRowIndex: action.rowIndex,
                                gripElement: action.gripElement,
                            },
                        };
                    case "UpdateDrag":
                        if (!value.dragging) return value;
                        return {
                            ...value,
                            dragging: {
                                ...value.dragging,
                                currentRowIndex: action.currentRowIndex,
                            },
                        };
                    case "EndDrag":
                        return {
                            ...value,
                            dragging: null,
                            dropTargetIndex: 0,
                            decorationSet: DecorationSet.empty,
                        };
                    default:
                        return value;
                }
            },
        },
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
                if (!isInContentTable(state)) return DecorationSet.empty;

                const pluginState = contentTableRowDragPluginKey.getState(state);
                if (!pluginState) return DecorationSet.empty;

                const decorations: Array<Decoration> = [];
                const rowCells = getCellsInColumn(0)(state.selection);

                return DecorationSet.create(state.doc, [
                    ...decorations,
                    ...(pluginState.decorationSet.find() || []),
                ]);
            },
        },
    });
};
