import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {
    getCellsInColumn,
    isInContentTable,
    selectionContentTableCell,
} from "~/client/content/internal/table/content_table_client_util.js";
import {createDragPreview} from "~/client/content/internal/table/content_table_drag_preview.js";
import {
    DraggableType,
    getDraggableDataFromEvent,
} from "~/client/content/internal/table/content_table_get_draggable_event_data.js";
import {contentStyles} from "~/client/styles/styles.js";
import {ContentTableMap} from "~/shared/content/table/content_table_map.js";
import {assert} from "~/shared/helpers/control/assert.js";

type ContentTableRowDragState = {
    dragging: {
        startY: number;
        startRowIndex: number;
        currentRowIndex: number;
        closestEdge: "top" | "bottom" | null;
        gripElement: HTMLElement | null;
        previewRect?: DOMRect;
    } | null;
};

type ContentTableRowDragAction =
    | {
          type: "StartDrag";
          startY: number;
          rowIndex: number;
          gripElement: HTMLElement | null;
          closestEdge: "top" | "bottom" | null;
          mouseX: number;
          mouseY: number;
          previewRect: DOMRect;
      }
    | {
          type: "UpdateDrag";
          currentRowIndex: number;
          closestEdge: "top" | "bottom" | null;
      }
    | {
          type: "EndDrag";
      };

export const contentTableRowDragPluginKey = new PluginKey<ContentTableRowDragState>(
    "contentTableRowDrag",
);

export const contentTableRowDragPlugin = (): Plugin => {
    let view: EditorView | null;
    let dragPreview: {destroy: () => void} | null = null;

    function removeDragPreview() {
        dragPreview?.destroy();
        dragPreview = null;
    }

    function updateDragPreview(rect: DOMRect, x: number, y: number) {
        removeDragPreview();

        dragPreview = createDragPreview({
            width: rect.width,
            height: rect.height,
            initialX: x,
            initialY: y,
            type: "row",
            onMove: (newX, newY) => {
                assert(view);
                const state = contentTableRowDragPluginKey.getState(view.state);
                assert(state?.dragging);

                const draggableData = getDraggableDataFromEvent(
                    new MouseEvent("mousemove", {clientX: newX, clientY: newY}),
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
                        closestEdge: draggableData.targetClosestEdge,
                    }),
                );
            },
        });
    }

    return new Plugin({
        key: contentTableRowDragPluginKey,
        state: {
            init(): ContentTableRowDragState {
                return {dragging: null};
            },
            apply(tr, value) {
                const action = tr.getMeta(contentTableRowDragPluginKey) as
                    | ContentTableRowDragAction
                    | undefined;
                if (!action) return value;

                switch (action.type) {
                    case "StartDrag":
                        removeDragPreview();
                        updateDragPreview(action.previewRect, action.mouseX, action.mouseY);

                        return {
                            dragging: {
                                startY: action.startY,
                                startRowIndex: action.rowIndex,
                                currentRowIndex: action.rowIndex,
                                gripElement: action.gripElement,
                                closestEdge: null,
                                previewRect: action.previewRect,
                            },
                        };
                    case "UpdateDrag":
                        if (!value.dragging) return value;
                        return {
                            dragging: {
                                ...value.dragging,
                                currentRowIndex: action.currentRowIndex,
                                closestEdge: action.closestEdge,
                            },
                        };
                    case "EndDrag": {
                        removeDragPreview();
                        return {dragging: null};
                    }
                }
            },
        },
        view: editorView => {
            view = editorView;
            return {
                destroy() {
                    removeDragPreview();
                    view = null;
                },
            };
        },
        props: {
            decorations: state => {
                if (!isInContentTable(state)) return DecorationSet.empty;
                assert(view);
                const pluginState = contentTableRowDragPluginKey.getState(view.state);
                if (!pluginState?.dragging) {
                    return DecorationSet.empty;
                }

                const decorations: Array<Decoration> = [];
                const $cell = selectionContentTableCell(state);
                const table = $cell.node(-1);
                const tableStart = $cell.start(-1);
                const map = ContentTableMap.get(table);

                const {startRowIndex, currentRowIndex} = pluginState.dragging;

                for (let col = 0; col < map.width; col++) {
                    if (
                        currentRowIndex === startRowIndex ||
                        (pluginState.dragging.closestEdge === "bottom" &&
                            currentRowIndex === startRowIndex - 1) ||
                        (pluginState.dragging.closestEdge === "top" &&
                            currentRowIndex === startRowIndex + 1)
                    ) {
                        continue;
                    }

                    const pos = map.positionAt(currentRowIndex, col, table);
                    const cell = table.nodeAt(pos);
                    if (!cell) continue;

                    const classes = [contentStyles.contentTableRowDragIndicatorClassName];

                    if (pluginState.dragging.closestEdge === "top") {
                        classes.push(contentStyles.contentTableRowDragTopIndicatorClassName);
                    } else if (pluginState.dragging.closestEdge === "bottom") {
                        classes.push(contentStyles.contentTableRowDragBottomIndicatorClassName);
                    }

                    decorations.push(
                        Decoration.node(tableStart + pos, tableStart + pos + cell.nodeSize, {
                            class: classes.join(" "),
                        }),
                    );
                }

                return DecorationSet.create(state.doc, decorations);
            },
        },
    });
};
