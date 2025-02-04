import {EditorState} from "prosemirror-state";
import {EditorView, serializeForClipboard} from "prosemirror-view";
import {RefObject, useLayoutEffect, useState} from "react";
import {
    getSelectedColumnGripInContentTable,
    getSelectedRowGripInContentTable,
    getSelectedTableGripInContentTable,
    isInContentTable,
} from "~/client/content/internal/table/content_table_client_util.js";
import {
    addContentTableColumnAfterSelection,
    addContentTableColumnBeforeSelection,
    addContentTableRowAfterSelection,
    addContentTableRowBeforeSelection,
    deleteContentTable,
    deleteContentTableColumn,
    deleteContentTableRow,
} from "~/client/content/internal/table/content_table_commands.js";
import {Menu, MenuAction} from "~/client/design/menu.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {useReporter} from "~/client/design/reporter.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Id, generateId} from "~/shared/id/id.js";

export type ContentEditorTableMenuState = {
    readonly key: Id;
    readonly targetElement: HTMLElement;
    readonly isVisible: boolean;
} & (
    | {
          readonly type: "row";
          readonly position: number;
      }
    | {
          readonly type: "column";
          readonly position: number;
      }
    | {
          readonly type: "selection";
      }
);

export const ContentEditorTableMenu = ({
    viewRef,
    state,
}: {
    viewRef: RefObject<EditorView>;
    state: EditorState;
}) => {
    const platform = usePlatform();
    const reporter = useReporter();

    const [menuState, setMenuState] = useState<ContentEditorTableMenuState | null>(null);

    useLayoutEffect(() => {
        if (!isInContentTable(state)) {
            setMenuState(null);
            return;
        }

        const view = assertExists(viewRef.current);

        const selectedTableGrip = getSelectedTableGripInContentTable({
            view,
            state,
        });
        if (selectedTableGrip) {
            setMenuState({
                type: "selection",
                key: generateId(),
                targetElement: selectedTableGrip as HTMLElement,
                isVisible: true,
            });
            return;
        }

        const selectedRowGrip = getSelectedRowGripInContentTable({
            view,
            state,
        });
        if (selectedRowGrip) {
            setMenuState({
                type: "row",
                key: generateId(),
                targetElement: selectedRowGrip as HTMLElement,
                position: state.selection.$from.pos,
                isVisible: true,
            });
            return;
        }

        const selectedColumnGrip = getSelectedColumnGripInContentTable({
            view,
            state,
        });
        if (selectedColumnGrip) {
            setMenuState({
                type: "column",
                key: generateId(),
                targetElement: selectedColumnGrip as HTMLElement,
                position: state.selection.$from.pos,
                isVisible: true,
            });
            return;
        }

        setMenuState(null);
    }, [state, viewRef]);

    const onCloseWithAnimation = () => {
        setMenuState(prev => (prev ? {...prev, isVisible: false} : null));
    };

    const onCloseWithoutAnimation = () => {
        setMenuState(null);
    };

    if (!menuState) return null;

    let actions: Array<MenuAction>;

    switch (menuState.type) {
        case "row": {
            actions = [
                {
                    label: "Add row after",
                    onPress: () => {
                        if (viewRef.current) {
                            addContentTableRowAfterSelection(state, viewRef.current.dispatch);
                            onCloseWithAnimation();
                        }
                    },
                },
                {
                    label: "Add row before",
                    onPress: () => {
                        if (viewRef.current) {
                            addContentTableRowBeforeSelection(state, viewRef.current.dispatch);
                            onCloseWithAnimation();
                        }
                    },
                },
                {
                    label: "Delete row",
                    onPress: () => {
                        if (viewRef.current) {
                            deleteContentTableRow(state, viewRef.current.dispatch);
                            onCloseWithAnimation();
                        }
                    },
                },
            ];
            break;
        }
        case "column": {
            actions = [
                {
                    label: "Add column after",
                    onPress: () => {
                        const view = assertExists(viewRef.current);

                        addContentTableColumnAfterSelection(view.state, view.dispatch);
                        onCloseWithAnimation();
                    },
                },
                {
                    label: "Add column before",
                    onPress: () => {
                        const view = assertExists(viewRef.current);

                        addContentTableColumnBeforeSelection(view.state, view.dispatch);
                        onCloseWithAnimation();
                    },
                },
                {
                    label: "Delete column",
                    onPress: () => {
                        const view = assertExists(viewRef.current);

                        deleteContentTableColumn(view.state, view.dispatch);
                        onCloseWithAnimation();
                    },
                },
            ];
            break;
        }
        case "selection": {
            actions = [
                {
                    label: "Copy table",
                    onPress: () => {
                        const view = assertExists(viewRef.current);
                        const tableGrip = getSelectedTableGripInContentTable({
                            view,
                            state: view.state,
                        });
                        if (!tableGrip) return;

                        // Find the table node and its position
                        const tablePos = view.posAtDOM(tableGrip, 0);
                        const $pos = view.state.doc.resolve(tablePos);

                        // Walk up to find the actual table node
                        let depth = $pos.depth;
                        let tableNode = null;
                        while (depth >= 0) {
                            const node = $pos.node(depth);
                            if (node.type.name === "table") {
                                tableNode = node;
                                break;
                            }
                            depth--;
                        }

                        if (!tableNode) return;

                        // Get the start position of the table
                        const startPos = $pos.start(depth);
                        const endPos = startPos + tableNode.nodeSize;

                        const {dom, text} = serializeForClipboard(
                            view,
                            view.state.doc.slice(startPos, endPos),
                        );

                        navigator.clipboard
                            .write([
                                new ClipboardItem({
                                    "text/html": new Blob([dom.innerHTML], {type: "text/html"}),
                                    "text/plain": new Blob([text], {type: "text/plain"}),
                                }),
                            ])
                            .catch(error => {
                                reporter.displayError("Couldn't copy table", error);
                            });
                    },
                },
                {
                    label: "Delete table",
                    onPress: () => {
                        if (viewRef.current) {
                            deleteContentTable(viewRef.current.state, viewRef.current.dispatch);
                            onCloseWithAnimation();
                        }
                    },
                },
            ];
            break;
        }
        default:
            throw exhaustive(menuState);
    }

    return (
        <OverlayAnimated
            isBlocking={false}
            isVisible={menuState.isVisible}
            offset={defaultTooltipOffset}
            placement="left-start"
            fallbackPlacements={["top-start"]}
            overflowBottom={platform === "mobile" ? "18rem" : undefined}
            targetElement={menuState.targetElement}
            overlay={
                <Menu
                    isNotFocusable={true}
                    actions={actions}
                    onCloseWithAnimation={onCloseWithAnimation}
                    onCloseWithoutAnimation={onCloseWithoutAnimation}
                />
            }
        />
    );
};
