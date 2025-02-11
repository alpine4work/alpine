import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {
    isInContentTable,
    selectionContentTableCell,
} from "~/client/content/internal/table/content_table_client_util.js";
import {contentStyles} from "~/client/styles/styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {assert} from "~/shared/helpers/control/assert.js";

type ContentTableColumnDragState = {
    dragging: {
        startX: number;
        startColumnIndex: number;
        currentColumnIndex: number;
        closestEdge: "left" | "right" | null;
        gripElement: HTMLElement | null;
    } | null;
};

type ContentTableColumnDragAction =
    | {
          type: "StartDrag";
          startX: number;
          columnIndex: number;
          gripElement: HTMLElement | null;
          closestEdge: "left" | "right" | null;
      }
    | {
          type: "UpdateDrag";
          currentColumnIndex: number;
          closestEdge: "left" | "right" | null;
      }
    | {
          type: "EndDrag";
      };

export const contentTableColumnDragPluginKey = new PluginKey<ContentTableColumnDragState>(
    "contentTableColumnDrag",
);

export function contentTableColumnDragPlugin(): Plugin {
    let view: EditorView | null;
    let dragCover: HTMLElement | null = null;

    return new Plugin({
        key: contentTableColumnDragPluginKey,
        state: {
            init(): ContentTableColumnDragState {
                return {dragging: null};
            },
            apply(tr, value) {
                const action = tr.getMeta(contentTableColumnDragPluginKey) as
                    | ContentTableColumnDragAction
                    | undefined;
                if (!action) return value;

                switch (action.type) {
                    case "StartDrag":
                        return {
                            dragging: {
                                startX: action.startX,
                                startColumnIndex: action.columnIndex,
                                currentColumnIndex: action.columnIndex,
                                gripElement: action.gripElement,
                                closestEdge: null,
                            },
                        };
                    case "UpdateDrag":
                        if (!value.dragging) return value;
                        return {
                            dragging: {
                                ...value.dragging,
                                currentColumnIndex: action.currentColumnIndex,
                                closestEdge: action.closestEdge,
                            },
                        };
                    case "EndDrag":
                        return {dragging: null};
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
            handleDOMEvents: {
                pointermove: view => {
                    const state = contentTableColumnDragPluginKey.getState(view.state);
                    if (!state?.dragging) return false;

                    return true;
                },
            },
            decorations: state => {
                if (!isInContentTable(state)) return DecorationSet.empty;
                assert(view);
                const pluginState = contentTableColumnDragPluginKey.getState(view.state);
                if (!pluginState?.dragging) {
                    return DecorationSet.empty;
                }

                const decorations: Array<Decoration> = [];
                const $cell = selectionContentTableCell(state);
                const table = $cell.node(-1);
                const tableStart = $cell.start(-1);
                const map = ContentTableMap.get(table);

                // Add decorations for the dragged column
                const {startColumnIndex, currentColumnIndex} = pluginState.dragging;

                // Calculate positions for the source column
                for (let row = 0; row < map.height; row++) {
                    const pos = map.positionAt(row, startColumnIndex, table);
                    const cell = table.nodeAt(pos);
                    if (!cell) continue;

                    decorations.push(
                        Decoration.node(tableStart + pos, tableStart + pos + cell.nodeSize, {
                            style: "opacity: 0.5;",
                        }),
                    );
                }

                // Calculate positions for the target column
                for (let row = 0; row < map.height; row++) {
                    const pos = map.positionAt(row, currentColumnIndex, table);
                    const cell = table.nodeAt(pos);
                    if (!cell) continue;

                    decorations.push(
                        Decoration.node(tableStart + pos, tableStart + pos + cell.nodeSize, {
                            class: contentStyles.contentTableColumnDragIndicatorClassName,
                        }),
                    );
                }

                return DecorationSet.create(state.doc, decorations);
            },
        },
    });
}
