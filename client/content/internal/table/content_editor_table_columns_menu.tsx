import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {RefObject, useEffect, useState} from "react";
import {TableMenuState} from "~/client/content/content_editor.js";
import {getSelectedColumnGripInContentTable} from "~/client/content/internal/table/content_table_client_util.js";
import {
    addContentTableColumnAfterSelection,
    addContentTableColumnBeforeSelection,
    deleteContentTableColumn,
} from "~/client/content/internal/table/content_table_commands.js";
import {Menu, MenuAction} from "~/client/design/menu.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {generateId} from "~/shared/id/id.js";

export const ContentEditorTableColumnsMenu = ({
    viewRef,
    state,
}: {
    viewRef: RefObject<EditorView>;
    state: EditorState;
}) => {
    const platform = usePlatform();
    const [menuState, setMenuState] = useState<TableMenuState | null>(null);

    useEffect(() => {
        const selectedColumnGrip = getSelectedColumnGripInContentTable({
            view: assertExists(viewRef.current),
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
                assert(viewRef.current);

                deleteContentTableColumn(viewRef.current.state, viewRef.current.dispatch);
                onCloseWithAnimation();
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
