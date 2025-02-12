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
        mouseX?: number;
        mouseY?: number;
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
      }
    | {
          type: "UpdateDrag";
          currentColumnIndex: number;
          closestEdge: "left" | "right" | null;
          mouseX: number;
          mouseY: number;
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

    function removeDragPreview() {
        if (dragCover) {
            dragCover.remove();
            dragCover = null;
        }
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
                        // Clean up any existing preview
                        removeDragPreview();
                        return {
                            dragging: {
                                startX: action.startX,
                                startColumnIndex: action.columnIndex,
                                currentColumnIndex: action.columnIndex,
                                gripElement: action.gripElement,
                                closestEdge: null,
                                mouseX: action.mouseX,
                                mouseY: action.mouseY,
                            },
                        };
                    case "UpdateDrag":
                        if (!value.dragging) return value;
                        return {
                            dragging: {
                                ...value.dragging,
                                currentColumnIndex: action.currentColumnIndex,
                                closestEdge: action.closestEdge,
                                mouseX: action.mouseX,
                                mouseY: action.mouseY,
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

                // Add drag preview that follows the cursor
                const dragging = pluginState.dragging;
                const mouseX = dragging?.mouseX;
                const mouseY = dragging?.mouseY;
                if (dragging && typeof mouseX === "number" && typeof mouseY === "number") {
                    // Get the dimensions of the dragged
                    const firstPos = map.positionAt(0, startColumnIndex, table);
                    const firstCell = table.nodeAt(firstPos);
                    if (firstCell) {
                        const cellDOM = view.nodeDOM(tableStart + firstPos) as HTMLElement;
                        if (cellDOM) {
                            const rect = cellDOM.getBoundingClientRect();
                            // Create a floating drag preview
                            if (!dragCover) {
                                dragCover = document.createElement("div");
                                dragCover.className =
                                    contentStyles.contentTableColumnDragPreviewClassName;
                                document.body.appendChild(dragCover);
                            }

                            dragCover.style.width = `${rect.width}px`;
                            dragCover.style.height = `${rect.height * map.height}px`;
                            dragCover.style.left = `${mouseX}px`;
                            dragCover.style.top = `${mouseY}px`;
                        }
                    }
                }

                return DecorationSet.create(state.doc, decorations);
            },
        },
    });
}
