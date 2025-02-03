/* eslint-disable @typescript-eslint/unbound-method */
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useEffect, useState} from "react";
import {TableMenuState} from "~/client/content/content_editor.js";
import {getSelectedRowGripInContentTable} from "~/client/content/internal/table/content_table_client_util.js";
import {
    addContentTableRowBeforeSelection,
    addContentTableRowAfterSelection,
    deleteContentTableRow,
} from "~/client/content/internal/table/content_table_commands.js";
import {Menu, MenuAction} from "~/client/design/menu.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";

export const ContentEditorTableRowsMenu = ({
    viewRef,
    state,
}: {
    viewRef: RefObject<EditorView>;
    state: EditorState;
}) => {
    const platform = usePlatform();
    const [menuState, setMenuState] = useState<TableMenuState | null>(null);

    useEffect(() => {
        const selectedRowGrip = getSelectedRowGripInContentTable({
            view: assertExists(viewRef.current),
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
            label: "Add Row after",
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
            label: "Delete Row",
            onPress: () => {
                if (viewRef.current) {
                    deleteContentTableRow(state, viewRef.current.dispatch);
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
