import {Plugin, PluginKey} from "prosemirror-state";
import {Decoration, DecorationSet, EditorView} from "prosemirror-view";
import {isInContentTable} from "~/client/content/internal/table/content_table_client_util.js";

type ContentTableColumnDragState = {
    dragging: {
        startX: number;
        startColumnIndex: number;
        currentColumnIndex: number;
        gripElement: HTMLElement | null;
    } | null;
};

type ContentTableColumnDragAction =
    | {
          type: "StartDrag";
          startX: number;
          columnIndex: number;
          gripElement: HTMLElement | null;
      }
    | {
          type: "UpdateDrag";
          currentColumnIndex: number;
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
                            },
                        };
                    case "UpdateDrag":
                        if (!value.dragging) return value;
                        return {
                            dragging: {
                                ...value.dragging,
                                currentColumnIndex: action.currentColumnIndex,
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
            decorations: state => {
                if (!isInContentTable(state)) return DecorationSet.empty;

                const decorations: Array<Decoration> = [];

                return DecorationSet.create(state.doc, decorations);
            },
        },
    });
}
