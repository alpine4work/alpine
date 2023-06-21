import {
    ReactElement,
    Ref,
    createRef,
    forwardRef,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box";
import {useOutsidePress} from "~/client/design/helpers/use_outside_interaction";
import {MenuAction, MenuItem, defaultMenuWidth} from "~/client/design/menu_button";
import {ModalDialog} from "~/client/design/modal_dialog";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {OverlayAnimated} from "~/client/design/overlay_animated";
import {isMac} from "~/client/helpers/browser/is_mac";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {sprinkles} from "~/shared/styles/styles";

const contextMenuEventActionsSymbol = Symbol("actions");

/**
 * Across our entire app we disable the native right-click menu. Because:
 *
 * - It doesn't feel app-like for the context menu to appear absolutely
 *   anywhere you right click. It only makes sense for interactive elements.
 * - It doesn't feel app-like for the context menu to be filled with web
 *   specific stuff. Like "Cast" in Chrome.
 * - It's inconsistent from a design perspective to sometimes use the native
 *   context menu and sometimes use a custom context menu depending on whether
 *   the target element needs it.
 *
 * We are building an app, not a website, so we have our own context menu
 * system that supports our needs.
 *
 * If you want to add some actions to the context menu then wrap a `<div>` (or
 * other HTML element) in this component. It will listen for context menu
 * events on child elements and add some actions when the user right-clicks.
 */
export function ContextMenuActions({
    actions,
    children,
}: {
    actions: ReadonlyArray<ReadonlyArray<MenuAction>>;
    children: ReactElement;
}) {
    const handleContextMenu = useEvent(
        (
            event: MouseEvent & {
                [contextMenuEventActionsSymbol]?: Array<ReadonlyArray<MenuAction>>;
            },
        ) => {
            const eventActions = (event[contextMenuEventActionsSymbol] ??= []);
            eventActions.unshift(...actions);
        },
    );

    const lifecycleRef = useCallback(
        (element: unknown) => {
            assert(
                element instanceof HTMLElement,
                "Expected the children of `<ContextMenuActions>` to render an element with a ref to an HTML element",
            );

            element.addEventListener("contextmenu", handleContextMenu);
            return () => {
                element.removeEventListener("contextmenu", handleContextMenu);
            };
        },
        [handleContextMenu],
    );

    return useElementWithRef(children, useLifecycleRef(lifecycleRef));
}

type ContextMenuInstanceState = {
    readonly x: number;
    readonly y: number;
    readonly actions: ReadonlyArray<ReadonlyArray<MenuAction>>;
    readonly focusedMenuItemIndex: number | null;
};

type ContextMenuState =
    | {
          readonly isOpen: false;
          readonly shouldAnimateOut: boolean;
          readonly lastInstance: ContextMenuInstanceState | null;
      }
    | {
          readonly isOpen: true;
          readonly instance: ContextMenuInstanceState;
      };

export function ContextMenuManager() {
    const [contextMenuState, setContextMenuState] = useState<ContextMenuState>({
        isOpen: false,
        shouldAnimateOut: false,
        lastInstance: null,
    });

    // Disable the native right-click menu everywhere in our app. This is an
    // artifact of the web and not common in apps. Instead we provide our own
    // right-click menu system where it makes sense.
    useEffect(() => {
        const handleContextMenu = (
            event: MouseEvent & {
                [contextMenuEventActionsSymbol]?: Array<ReadonlyArray<MenuAction>>;
            },
        ) => {
            event.preventDefault();

            const actions: Array<ReadonlyArray<MenuAction>> =
                event[contextMenuEventActionsSymbol] ?? [];

            // If we right-clicked on a text input then add our standard text
            // processing actions.
            if (document.activeElement && isTextInputElement(document.activeElement)) {
                const isTextSelectedInInput =
                    document.activeElement instanceof HTMLInputElement &&
                    document.activeElement.selectionStart !== document.activeElement.selectionEnd;

                const selection = window.getSelection();

                const isTextSelectedInContentEditable =
                    document.activeElement instanceof HTMLElement &&
                    document.activeElement.isContentEditable &&
                    selection &&
                    selection.anchorOffset !== selection.focusOffset;

                const isTextSelected = isTextSelectedInInput || isTextSelectedInContentEditable;

                actions.unshift([
                    {
                        label: "Cut",
                        isDisabled: !isTextSelected,
                        keyboardShortcutHint: isMac ? "⌘+X" : "Ctrl+X",
                        onPress: () => {
                            document.execCommand("cut");
                        },
                    },
                    {
                        label: "Copy",
                        isDisabled: !isTextSelected,
                        keyboardShortcutHint: isMac ? "⌘+C" : "Ctrl+C",
                        onPress: () => {
                            document.execCommand("copy");
                        },
                    },
                    {
                        label: "Paste",
                        keyboardShortcutHint: isMac ? "⌘+V" : "Ctrl+V",
                        onPress: () => {
                            // TODO(calebmer): Enable support for pasting in desktop app wrapper. When we
                            // have a desktop app wrapper also ask the user if they want to install the app
                            // to paste.
                            setShouldShowPasteWarningDialog(true);
                        },
                    },
                ]);
            }
            // If we right-clicked on selectable text then add our standard text
            // processing actions.
            else if (
                event.target instanceof HTMLElement &&
                getComputedStyle(event.target).userSelect !== "none"
            ) {
                const selection = window.getSelection();
                if (selection && selection.anchorOffset !== selection.focusOffset) {
                    actions.unshift([
                        {
                            label: "Copy",
                            keyboardShortcutHint: isMac ? "⌘+C" : "Ctrl+C",
                            onPress: () => {
                                document.execCommand("copy");
                            },
                        },
                    ]);
                }
            }

            if (actions.length > 0) {
                setContextMenuState({
                    isOpen: true,
                    instance: {
                        x: event.clientX,
                        y: event.clientY,
                        actions,
                        focusedMenuItemIndex: null,
                    },
                });
            }
        };

        document.addEventListener("contextmenu", handleContextMenu);
        return () => {
            document.removeEventListener("contextmenu", handleContextMenu);
        };
    }, []);

    const [shouldShowPasteWarningDialog, setShouldShowPasteWarningDialog] = useState(false);

    const instance = contextMenuState.isOpen
        ? contextMenuState.instance
        : contextMenuState.lastInstance;
    if (!instance) return null;

    return (
        <>
            {createPortal(
                <OverlayScopeContextProvider
                    // Position above our other overlays.
                    zIndex="70"
                >
                    <OverlayAnimated
                        isVisible={contextMenuState.isOpen}
                        placement="bottom-start"
                        disableAnimationIn={true}
                        disableAnimationOut={
                            !contextMenuState.isOpen && !contextMenuState.shouldAnimateOut
                        }
                        overlay={
                            <ContextMenu
                                actions={instance.actions}
                                focusedMenuItemIndex={instance.focusedMenuItemIndex}
                                onFocusedMenuItemIndexChange={focusedMenuItemIndex => {
                                    setContextMenuState(contextMenuState => {
                                        if (!contextMenuState.isOpen) return contextMenuState;
                                        return {
                                            ...contextMenuState,
                                            instance: {
                                                ...contextMenuState.instance,
                                                focusedMenuItemIndex,
                                            },
                                        };
                                    });
                                }}
                                onCloseWithAnimation={() => {
                                    setContextMenuState({
                                        isOpen: false,
                                        shouldAnimateOut: true,
                                        lastInstance: instance,
                                    });
                                }}
                                onCloseWithoutAnimation={() => {
                                    setContextMenuState({
                                        isOpen: false,
                                        shouldAnimateOut: false,
                                        lastInstance: instance,
                                    });
                                }}
                            />
                        }
                    >
                        <Box position="absolute" style={{left: instance.x, top: instance.y}} />
                    </OverlayAnimated>
                </OverlayScopeContextProvider>,
                document.body,
            )}
            {contextMenuState.isOpen &&
                // Add a cover to the document to prevent scrolling and hover effects while the
                // context menu is open. Should render over all overlays accept our context
                // menu overlay.
                createPortal(<Box position="absolute" inset="0" zIndex="60" />, document.body)}
            {shouldShowPasteWarningDialog && (
                <ModalDialog
                    title={`Can only paste with ${isMac ? "⌘+V" : "Ctrl+V"}`}
                    description={`For security purposes, your browser only allows pasting with the keyboard shortcut ${
                        isMac ? "⌘+V" : "Ctrl+V"
                    }. Try again but instead of right clicking use the keyboard shortcut.`}
                    primaryButtonLabel="Ok"
                    onPrimaryButtonPress={() => setShouldShowPasteWarningDialog(false)}
                    shouldHideCancelButton={true}
                    onClose={() => setShouldShowPasteWarningDialog(false)}
                />
            )}
        </>
    );
}

const ContextMenu = forwardRef(function ContextMenu(
    {
        actions: nestedActions,
        focusedMenuItemIndex,
        onFocusedMenuItemIndexChange,
        onCloseWithAnimation,
        onCloseWithoutAnimation,
    }: {
        actions: ReadonlyArray<ReadonlyArray<MenuAction>>;
        focusedMenuItemIndex: number | null;
        onFocusedMenuItemIndexChange: (focusedMenuItemIndex: number | null) => void;
        onCloseWithAnimation: () => void;
        onCloseWithoutAnimation: () => void;
    },
    ref: Ref<HTMLDivElement>,
) {
    const flattenedActions = useMemo(() => {
        const flattenedActions: Array<{type: "Action"; action: MenuAction} | {type: "Divider"}> =
            [];

        for (const nestedAction of nestedActions) {
            if (flattenedActions.length > 0) {
                flattenedActions.push({type: "Divider"});
            }

            for (const action of nestedAction) {
                flattenedActions.push({type: "Action", action});
            }
        }

        return flattenedActions;
    }, [nestedActions]);

    assert(flattenedActions.length > 0);

    const menuItemRefs = useMemo(
        () =>
            flattenedActions.map(action =>
                action.type === "Action" ? createRef<HTMLDivElement>() : null,
            ),
        [flattenedActions],
    );

    const [searchText, setSearchText] = useState("");

    // We want to reset the search text back to an empty string after some period
    // of time whenever it changes.
    useEffect(() => {
        if (searchText === "") return;

        const timeout = createTimeout(() => {
            setSearchText("");
        }, 1000);

        return () => {
            timeout.clear();
        };
    }, [searchText]);

    // We don't focus the context menu since that would mean we lose focus on the
    // element where the user right-clicked. Instead we attach a global keydown
    // listener and manage focus in component state.
    const handleGlobalKeyDown = useEvent((event: KeyboardEvent) => {
        switch (event.key) {
            // Don't allow using tab to move keyboard focus while the context menu is open.
            case "Tab": {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            // Close the focus menu when pressing escape.
            case "Escape": {
                event.preventDefault();
                event.stopPropagation();
                onCloseWithoutAnimation();
                return;
            }

            // Select the focused item when the user presses enter.
            case "Enter":
            case " ": {
                event.preventDefault();
                event.stopPropagation();
                if (focusedMenuItemIndex !== null)
                    menuItemRefs[focusedMenuItemIndex]?.current?.click();
                return;
            }

            // When focus is in a menu, moves focus to the next item, optionally
            // wrapping from the last to the first.
            //
            // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
            case "ArrowDown": {
                event.preventDefault();
                event.stopPropagation();

                if (focusedMenuItemIndex !== null) {
                    for (
                        let index = focusedMenuItemIndex + 1;
                        index < flattenedActions.length;
                        index++
                    ) {
                        const flattenedAction = flattenedActions[index]!;
                        if (flattenedAction.type === "Action") {
                            onFocusedMenuItemIndexChange(index);
                            return;
                        }
                    }
                }

                // If we did not find a menu item after `currentIndex` then loop back around to
                // the first menu item.
                for (let index = 0; index < flattenedActions.length; index++) {
                    const flattenedAction = flattenedActions[index]!;
                    if (flattenedAction.type === "Action") {
                        onFocusedMenuItemIndexChange(index);
                        return;
                    }
                }
                return;
            }

            // When focus is in a menu, moves focus to the previous item,
            // optionally wrapping from the first to the last.
            //
            // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
            case "ArrowUp": {
                event.preventDefault(); // Don’t scroll
                event.stopPropagation();

                if (focusedMenuItemIndex !== null) {
                    for (let index = focusedMenuItemIndex - 1; index >= 0; index--) {
                        const flattenedAction = flattenedActions[index]!;
                        if (flattenedAction.type === "Action") {
                            onFocusedMenuItemIndexChange(index);
                            return;
                        }
                    }
                }

                // If we did not find a menu item before `currentIndex` then loop back around to
                // the first menu item.
                for (let index = flattenedActions.length - 1; index >= 0; index--) {
                    const flattenedAction = flattenedActions[index]!;
                    if (flattenedAction.type === "Action") {
                        onFocusedMenuItemIndexChange(index);
                        return;
                    }
                }
                return;
            }

            // Moves focus to the first item in the current menu. Technically, the spec
            // says only implement if arrow key wrapping is not supported but it's easy
            // to support so why not.
            //
            // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
            case "Home": {
                event.preventDefault(); // Don't scroll
                event.stopPropagation();

                for (let index = 0; index < flattenedActions.length; index++) {
                    const flattenedAction = flattenedActions[index]!;
                    if (flattenedAction.type === "Action") {
                        onFocusedMenuItemIndexChange(index);
                        return;
                    }
                }
                return;
            }

            // Moves focus to the last item in the current menu. Technically, the spec
            // says only implement if arrow key wrapping is not supported but it's easy
            // to support so why not.
            //
            // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
            case "End": {
                event.preventDefault(); // Don't scroll
                event.stopPropagation();

                for (let index = flattenedActions.length - 1; index >= 0; index--) {
                    const flattenedAction = flattenedActions[index]!;
                    if (flattenedAction.type === "Action") {
                        onFocusedMenuItemIndexChange(index);
                        return;
                    }
                }
                return;
            }

            default: {
                // Move focus to the next menu item in the current menu whose label
                // begins with that printable character.
                //
                // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                if (
                    /^[0-9a-zA-Z]$/.test(event.key) &&
                    // Keyboard shortcuts like Cmd-C shouldn't search.
                    (event.shiftKey || !isModifiedKeyboardEvent(event))
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                    const nextSearchText = searchText + event.key;
                    const nextIndex = flattenedActions.findIndex(
                        action =>
                            action.type === "Action" &&
                            !action.action.withCustomLayout &&
                            action.action.label.slice(0, nextSearchText.length).toLowerCase() ===
                                nextSearchText.toLowerCase(),
                    );
                    if (nextIndex !== -1) onFocusedMenuItemIndexChange(nextIndex);
                    setSearchText(nextSearchText);
                    return;
                }

                // Ignore modifier keys since the user may be starting a keyboard shortcut and
                // they need to see the context menu for the keyboard shortcut hint.
                if (
                    event.key === "Meta" ||
                    event.key === "Alt" ||
                    event.key === "Control" ||
                    event.key === "Shift"
                ) {
                    return;
                }

                // Close our context menu after any unrecognized keypress.
                onCloseWithoutAnimation();
                return;
            }
        }
    });

    useEffect(() => {
        document.addEventListener("keydown", handleGlobalKeyDown, {capture: true});
        return () => {
            document.removeEventListener("keydown", handleGlobalKeyDown, {capture: true});
        };
    }, [handleGlobalKeyDown]);

    return (
        <div
            ref={useMergedRefs<HTMLDivElement>(ref, useOutsidePress(onCloseWithAnimation))}
            className={sprinkles({
                minWidth: defaultMenuWidth,
                borderRadius: "md",
                padding: "1",
                backgroundColor: {light: "grey-0", dark: "grey-5"},
                boxShadow: "elevation-20",
            })}
        >
            {flattenedActions.map((action, index) => {
                switch (action.type) {
                    case "Divider": {
                        return (
                            <Box key={index} paddingX="1" paddingY="1">
                                <Box width="full" borderBottom="grey-5" />
                            </Box>
                        );
                    }
                    case "Action": {
                        return (
                            <MenuItem
                                key={index}
                                ref={menuItemRefs[index]}
                                action={action.action}
                                onCloseWithAnimation={onCloseWithAnimation}
                                onCloseWithoutAnimation={onCloseWithoutAnimation}
                                isNotFocusable={true}
                                isFocusRingVisible={focusedMenuItemIndex === index}
                            />
                        );
                    }
                    default:
                        throw exhaustive(action);
                }
            })}
        </div>
    );
});
