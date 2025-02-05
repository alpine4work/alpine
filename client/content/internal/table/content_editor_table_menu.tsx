import {Copy, Trash} from "phosphor-react";
import {EditorState} from "prosemirror-state";
import {EditorView, serializeForClipboard} from "prosemirror-view";
import {RefObject, useLayoutEffect, useState} from "react";
import {
    isInContentTable,
    selectionContentTableCell,
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
import {OverlayPlacement} from "~/client/design/overlay.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {useReporter} from "~/client/design/reporter.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {ColumnsPlusLeftIcon} from "~/client/icons/columns_plus_left_icon.js";
import {ColumnsPlusRightIcon} from "~/client/icons/columns_plus_right_icon.js";
import {RowsPlusBottomIcon} from "~/client/icons/rows_plus_bottom_icon.js";
import {RowsPlusTopIcon} from "~/client/icons/rows_plus_top_icon.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {contentStyles} from "~/client/styles/styles.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {noop} from "~/shared/helpers/control/noop.js";
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

        let isCancelled = false;

        // Run after a microtask since our parent effects need to run first and update
        // the DOM.
        scheduleMicrotask(() => {
            if (isCancelled) return;

            const view = assertExists(viewRef.current);

            const $cell = selectionContentTableCell(state);
            const tablePos = $cell.start(-1);

            let tableElement: HTMLTableElement | null = null;
            {
                let element: globalThis.Node | null = view.domAtPos(tablePos).node;
                while (element && element.nodeName != "TABLE") element = element.parentNode;

                tableElement = element as HTMLTableElement | null;
            }
            if (!tableElement) {
                setMenuState(null);
                return;
            }

            {
                const selectedTableGripButtonElement = tableElement.querySelector(
                    `.${contentStyles.tableGripButtonClassName}.${contentStyles.tableGripButtonSelectedClassName}`,
                );
                if (selectedTableGripButtonElement) {
                    setMenuState(menuState => {
                        if (menuState?.targetElement === selectedTableGripButtonElement)
                            return menuState;

                        return {
                            type: "selection",
                            key: generateId(),
                            targetElement: selectedTableGripButtonElement as HTMLElement,
                            isVisible: true,
                        };
                    });
                    return;
                }
            }

            {
                const selectedTableGripRowElement = tableElement.querySelector(
                    `.${contentStyles.tableGripClassName}.${contentStyles.tableGripRowClassName}.${contentStyles.tableGripSelectedClassName}`,
                );
                if (selectedTableGripRowElement) {
                    setMenuState(menuState => {
                        if (menuState?.targetElement === selectedTableGripRowElement)
                            return menuState;

                        return {
                            type: "row",
                            key: generateId(),
                            targetElement: selectedTableGripRowElement as HTMLElement,
                            position: state.selection.$from.pos,
                            isVisible: true,
                        };
                    });
                    return;
                }
            }

            {
                const selectedTableGripColumnElement = tableElement.querySelector(
                    `.${contentStyles.tableGripClassName}.${contentStyles.tableGripColumnClassName}.${contentStyles.tableGripSelectedClassName}`,
                );
                if (selectedTableGripColumnElement) {
                    setMenuState(menuState => {
                        if (menuState?.targetElement === selectedTableGripColumnElement)
                            return menuState;

                        return {
                            type: "column",
                            key: generateId(),
                            targetElement: selectedTableGripColumnElement as HTMLElement,
                            position: state.selection.$from.pos,
                            isVisible: true,
                        };
                    });
                    return;
                }
            }

            setMenuState(null);
        });

        return () => {
            isCancelled = true;
        };
    }, [state, viewRef]);

    if (!menuState) return null;

    let placement: OverlayPlacement;
    let actions: Array<MenuAction>;

    switch (menuState.type) {
        case "row": {
            placement = "left";

            actions = [
                {
                    label: "Add row before",
                    icon: <RowsPlusTopIcon />,
                    onPress: () => {
                        const view = assertExists(viewRef.current);
                        addContentTableRowBeforeSelection(state, view.dispatch);
                    },
                },
                {
                    label: "Add row after",
                    icon: <RowsPlusBottomIcon />,
                    onPress: () => {
                        const view = assertExists(viewRef.current);
                        addContentTableRowAfterSelection(state, view.dispatch);
                    },
                },
                {
                    label: "Delete row",
                    icon: <Trash />,
                    onPress: () => {
                        const view = assertExists(viewRef.current);
                        deleteContentTableRow(state, view.dispatch);
                    },
                },
            ];
            break;
        }
        case "column": {
            placement = "top";

            actions = [
                {
                    label: "Add column before",
                    icon: <ColumnsPlusLeftIcon style={{transform: "translateX(-0.125rem)"}} />,
                    onPress: () => {
                        const view = assertExists(viewRef.current);
                        addContentTableColumnBeforeSelection(view.state, view.dispatch);
                    },
                },
                {
                    label: "Add column after",
                    icon: <ColumnsPlusRightIcon style={{transform: "translateX(0.0625rem)"}} />,
                    onPress: () => {
                        const view = assertExists(viewRef.current);
                        addContentTableColumnAfterSelection(view.state, view.dispatch);
                    },
                },
                {
                    label: "Delete column",
                    icon: <Trash />,
                    onPress: () => {
                        const view = assertExists(viewRef.current);
                        deleteContentTableColumn(view.state, view.dispatch);
                    },
                },
            ];
            break;
        }
        case "selection": {
            placement = "top-start";

            actions = [
                {
                    label: "Copy table",
                    icon: <Copy />,
                    onPress: () => {
                        if (!isInContentTable(state)) return;

                        const view = assertExists(viewRef.current);

                        const $cell = selectionContentTableCell(state);
                        const table = $cell.node(-1);
                        const tablePos = $cell.start(-1);

                        const {dom, text} = serializeForClipboard(
                            view,
                            view.state.doc.slice(tablePos - 1, tablePos - 1 + table.nodeSize),
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
                    icon: <Trash />,
                    onPress: () => {
                        const view = assertExists(viewRef.current);
                        deleteContentTable(view.state, view.dispatch);
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
            key={menuState.key}
            disableAnimationIn={true}
            isVisible={menuState.isVisible}
            offset={defaultTooltipOffset}
            placement={placement}
            fallbackPlacements={emptyArray}
            overflowBottom={platform === "mobile" ? "18rem" : undefined}
            targetElement={menuState.targetElement}
            overlay={
                <Menu
                    isNotFocusable={true}
                    shouldNotCloseAfterActionPress={true}
                    actions={actions}
                    // The menu should stay open while content in the table is selected. Ignore any
                    // calls to close the menu.
                    onCloseWithAnimation={noop}
                    onCloseWithoutAnimation={noop}
                />
            }
        />
    );
};
