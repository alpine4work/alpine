import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {createElement} from "react";
import {createRoot} from "react-dom/client";
import {
    isInContentTable,
    selectionContentTableCell,
} from "~/client/content/internal/table/content_table_client_util.js";
import {ContentTableDragPreview} from "~/client/content/internal/table/content_table_drag_preview.js";
import {
    DraggableType,
    getDraggableDataFromEvent,
} from "~/client/content/internal/table/content_table_get_draggable_event_data.js";
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
        previewRect?: DOMRect;
    } | null;
};

type ContentTableColumnDragAction =
    | {
          type: "StartDrag";
          startX: number;
          columnIndex: number;
          gripElement: HTMLElement | null;
          closestEdge: "left" | "right" | null;
          mouseX: number;
          mouseY: number;
          previewRect: DOMRect;
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
    let dragPreviewRoot: ReturnType<typeof createRoot> | null = null;

    function removeDragPreview() {
        if (dragPreviewRoot) {
            dragPreviewRoot.unmount();
            dragPreviewRoot = null;
        }
    }

    function updateDragPreview(rect: DOMRect, x: number, y: number) {
        if (!dragPreviewRoot) {
            const container = document.createElement("div");
            dragPreviewRoot = createRoot(container);
            document.body.appendChild(container);
        }
        dragPreviewRoot.render(
            createElement(ContentTableDragPreview, {
                width: rect.width,
                height: rect.height,
                initialX: x,
                initialY: y,
                type: "column",
                onMove: (newX, newY) => {
                    assert(view);
                    const state = contentTableColumnDragPluginKey.getState(view.state);
                    assert(state?.dragging);

                    const draggableData = getDraggableDataFromEvent(
                        new MouseEvent("mousemove", {clientX: newX, clientY: newY}),
                        view,
                        DraggableType.TABLE_COLUMN,
                    );

                    assert(draggableData);
                    const newColumnIndex = draggableData.targetAdjustedIndex;
                    if (newColumnIndex === state.dragging.currentColumnIndex) return;

                    view.dispatch(
                        view.state.tr.setMeta(contentTableColumnDragPluginKey, {
                            type: "UpdateDrag",
                            currentColumnIndex: newColumnIndex,
                            closestEdge: draggableData.targetClosestEdge,
                        }),
                    );
                },
            }),
        );
    }

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
                        removeDragPreview();
                        updateDragPreview(action.previewRect, action.mouseX, action.mouseY);
                        return {
                            dragging: {
                                startX: action.startX,
                                startColumnIndex: action.columnIndex,
                                currentColumnIndex: action.columnIndex,
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
                                currentColumnIndex: action.currentColumnIndex,
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
                const pluginState = contentTableColumnDragPluginKey.getState(view.state);
                if (!pluginState?.dragging) {
                    return DecorationSet.empty;
                }

                const decorations: Array<Decoration> = [];
                const $cell = selectionContentTableCell(state);
                const table = $cell.node(-1);
                const tableStart = $cell.start(-1);
                const map = ContentTableMap.get(table);

                const {startColumnIndex, currentColumnIndex} = pluginState.dragging;

                for (let row = 0; row < map.height; row++) {
                    if (
                        currentColumnIndex === startColumnIndex ||
                        (pluginState.dragging.closestEdge === "right" &&
                            currentColumnIndex === startColumnIndex - 1) ||
                        (pluginState.dragging.closestEdge === "left" &&
                            currentColumnIndex === startColumnIndex + 1)
                    ) {
                        continue;
                    }

                    const pos = map.positionAt(row, currentColumnIndex, table);
                    const cell = table.nodeAt(pos);
                    if (!cell) continue;

                    const classes = [contentStyles.contentTableColumnDragIndicatorClassName];

                    if (pluginState.dragging.closestEdge === "left") {
                        classes.push(contentStyles.contentTableColumnDragLeftIndicatorClassName);
                    } else if (pluginState.dragging.closestEdge === "right") {
                        classes.push(contentStyles.contentTableColumnDragRightIndicatorClassName);
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
}
