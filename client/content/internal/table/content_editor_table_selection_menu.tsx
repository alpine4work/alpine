/* eslint-disable react-compiler/react-compiler */
/* eslint-disable @typescript-eslint/unbound-method */
import {NodeSelection, Transaction} from "prosemirror-state";
import {EditorView, serializeForClipboard} from "prosemirror-view";
import {RefObject, useCallback, useLayoutEffect, useState} from "react";
import {getSelectedTableGripInContentTable} from "~/client/content/internal/table/content_table_client_util.js";
import {deleteContentTableColumn} from "~/client/content/internal/table/content_table_commands.js";
import {Menu, MenuAction} from "~/client/design/menu.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {Reporter} from "~/client/design/reporter.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Id, generateId} from "~/shared/id/id.js";

export const ContentEditorTableSelectionMenu = ({
    viewRef,
    getReporter,
}: {
    viewRef: RefObject<EditorView>;
    getReporter: () => Reporter;
}) => {
    const platform = usePlatform();
    const [menuState, setMenuState] = useState<{
        readonly key: Id;
        readonly targetElement: HTMLElement;
    } | null>(null);

    useLayoutEffect(() => {
        if (!viewRef.current) return;

        const view = viewRef.current;
        const handleUpdate = (tr: Transaction) => {
            const tableGrip = getSelectedTableGripInContentTable({
                view,
                state: view.state,
            });

            if (tableGrip) {
                const targetElement = tableGrip;
                if (targetElement && (!menuState || menuState.targetElement !== targetElement)) {
                    setMenuState({
                        key: menuState?.key ?? generateId(),
                        targetElement: targetElement as HTMLElement,
                    });
                }
            } else if (menuState) {
                setMenuState(null);
            }
        };

        // Initial check
        handleUpdate(view.state.tr);

        // Subscribe to state updates using a ref to avoid closure issues
        const originalDispatch = view.dispatch;
        const dispatchRef = {current: originalDispatch};

        view.dispatch = (tr: Transaction) => {
            dispatchRef.current.call(view, tr);
            handleUpdate(tr);
        };

        return () => {
            view.dispatch = originalDispatch;
        };
    }, [viewRef, menuState]);

    // Check if target is still valid
    if (menuState && !document.body.contains(menuState.targetElement)) {
        setMenuState(null);
    }

    if (!menuState) return null;

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
                // Delete column actions
                if (viewRef.current) {
                    deleteContentTableColumn(viewRef.current.state, viewRef.current.dispatch);
                }
            },
        },
    ];

    return (
        <OverlayAnimated
            isBlocking={false}
            isVisible={!!menuState}
            offset={defaultTooltipOffset}
            placement="top-start"
            fallbackPlacements={["top-start"]}
            overflowBottom={platform === "mobile" ? "18rem" : undefined}
            targetElement={assertExists(menuState?.targetElement)}
            overlay={
                <Menu
                    isNotFocusable={true}
                    actions={actions}
                    onCloseWithAnimation={() => setMenuState(null)}
                    onCloseWithoutAnimation={() => setMenuState(null)}
                />
            }
        />
    );
};
