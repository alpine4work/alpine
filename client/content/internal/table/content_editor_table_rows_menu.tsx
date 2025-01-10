/* eslint-disable react-compiler/react-compiler */
/* eslint-disable @typescript-eslint/unbound-method */
import {Transaction} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useLayoutEffect, useState} from "react";
import {getSelectedRowGripInContentTable} from "~/client/content/internal/table/content_table_client_util.js";
import {
    addContentTableRowBefore,
    addRowAfter,
    deleteContentTableRow,
} from "~/client/content/internal/table/content_table_commands.js";
import {Menu, MenuAction} from "~/client/design/menu.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Id, generateId} from "~/shared/id/id.js";

export const ContentEditorTableRowsMenu = ({viewRef}: {viewRef: RefObject<EditorView>}) => {
    const platform = usePlatform();
    const [menuState, setMenuState] = useState<{
        readonly key: Id;
        readonly targetElement: HTMLElement;
    } | null>(null);

    useLayoutEffect(() => {
        if (!viewRef.current) return;

        const view = viewRef.current;
        const handleUpdate = (tr: Transaction) => {
            const selectedRowGrip = getSelectedRowGripInContentTable({
                view,
                state: view.state,
            });

            if (selectedRowGrip) {
                const targetElement = selectedRowGrip;
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
            label: "Add Row after",
            onPress: () => {
                // Add row actions
                if (viewRef.current) {
                    addRowAfter(viewRef.current.state, viewRef.current.dispatch);
                }
            },
        },
        {
            label: "Add row before",
            onPress: () => {
                if (viewRef.current) {
                    addContentTableRowBefore(viewRef.current.state, viewRef.current.dispatch);
                }
            },
        },
        {
            label: "Delete Row",
            onPress: () => {
                // Delete column actions
                if (viewRef.current) {
                    deleteContentTableRow(viewRef.current.state, viewRef.current.dispatch);
                }
            },
        },
    ];

    return (
        <OverlayAnimated
            isBlocking={false}
            isVisible={!!menuState}
            offset={defaultTooltipOffset}
            placement="left-start"
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
