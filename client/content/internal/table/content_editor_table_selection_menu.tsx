import {EditorState} from "prosemirror-state";
import {EditorView, serializeForClipboard} from "prosemirror-view";
import {RefObject, useEffect, useState} from "react";
import {TableMenuState} from "~/client/content/content_editor.js";
import {getSelectedTableGripInContentTable} from "~/client/content/internal/table/content_table_client_util.js";
import {deleteContentTable} from "~/client/content/internal/table/content_table_commands.js";
import {Menu, MenuAction} from "~/client/design/menu.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {Reporter} from "~/client/design/reporter.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";

export const ContentEditorTableSelectionMenu = ({
    viewRef,
    state,
    getReporter,
}: {
    viewRef: RefObject<EditorView>;
    state: EditorState;
    getReporter: () => Reporter;
}) => {
    const platform = usePlatform();
    const [menuState, setMenuState] = useState<TableMenuState | null>(null);

    useEffect(() => {
        const selectedTableGrip = getSelectedTableGripInContentTable({
            view: assertExists(viewRef.current),
            state,
        });

        if (selectedTableGrip) {
            setMenuState({
                type: "selection",
                key: generateId(),
                targetElement: selectedTableGrip as HTMLElement,
                isVisible: true,
            });
        } else {
            setMenuState(null);
        }
    }, [state, viewRef]);

    const onCloseWithAnimation = () => {
        setMenuState(prev => (prev ? {...prev, isVisible: false} : null));
    };

    const onCloseWithoutAnimation = () => {
        setMenuState(null);
    };

    const actions: Array<MenuAction> = [
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
                        getReporter().displayError("Couldn't copy table", error);
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

    if (!menuState) return null;

    return (
        <OverlayAnimated
            isBlocking={false}
            isVisible={menuState.isVisible}
            offset={defaultTooltipOffset}
            placement="top-start"
            fallbackPlacements={["left-start"]}
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
