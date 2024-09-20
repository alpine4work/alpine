import {setInteractionModality} from "@react-aria/interactions";
import classNames from "classnames";
import {
    ReactElement,
    ReactNode,
    Ref,
    RefCallback,
    createContext,
    createRef,
    forwardRef,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {createPortal} from "react-dom";
import {findSpans as findUnicodeDefaultWordBoundarySpans} from "unicode-default-word-boundary";
import {Box} from "~/client/design/box.js";
import {useOutsidePress} from "~/client/design/helpers/use_outside_interaction.js";
import {MenuAction, MenuChildrenAction, MenuItem, menuSizeConstants} from "~/client/design/menu.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {greyElevated2ClassName, sprinkles} from "~/client/styles/styles.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterableFind} from "~/shared/helpers/iterable/iterable_find.js";
import {generateId} from "~/shared/id/id.js";

const contextMenuEventActionsSymbol = Symbol("actions");

/**
 * Create a context menu actions ref if you want to avoid rendering another
 * component with `<ContextMenuActions>` for performance reasons.
 */
export function useContextMenuActionsRef(
    actions: ReadonlyArray<ReadonlyArray<MenuAction>>,
): RefCallback<HTMLElement> {
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
        (element: HTMLElement) => {
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

    return useLifecycleRef(lifecycleRef);
}

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
    return useElementWithRef(children, useContextMenuActionsRef(actions));
}

const IsContextMenuOpenContext = createContext<boolean>(false);

/**
 * Returns true if the context menu is open.
 */
export function useIsContextMenuOpen() {
    return useContext(IsContextMenuOpenContext);
}

type ContextMenuInstanceState = {
    readonly x: number;
    readonly y: number;
    readonly actions: ReadonlyArray<ReadonlyArray<MenuAction>>;
    readonly focusedMenuItemIndex: number | null;
    readonly targetId: string;
};

type ContextMenuState =
    | {
          readonly isOpen: false;
          readonly shouldAnimateOut: false;
          readonly lastInstance: null;
      }
    | {
          readonly isOpen: false;
          readonly shouldAnimateOut: true;
          readonly lastInstance: ContextMenuInstanceState | null;
      }
    | {
          readonly isOpen: true;
          readonly instance: ContextMenuInstanceState;
      };

export function ContextMenuContextProvider({children}: {children?: ReactNode}) {
    const {isAppleDevice} = useClientInfo();

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
            // The Chrome mobile device debugger (and so probably also Chrome on Android)
            // fires the `contextmenu` event after a long press. This breaks any long press
            // functionality we might add so call `event.preventDefault()` and don't open
            // our custom context menu.
            if ("pointerType" in event && event.pointerType !== "mouse") {
                event.preventDefault();
                return;
            }

            // If the user was holding shift then show the default browser context menu.
            //
            // TODO(calebmer): If we ever have a native app wrapper, disable this behavior
            // in the native app wrapper. Only allow our custom context menu there.
            if (event.shiftKey) return;

            event.preventDefault();

            const actions: Array<ReadonlyArray<MenuAction>> =
                event[contextMenuEventActionsSymbol] ?? [];

            // If we right-clicked on a text input then add our standard text
            // processing actions.
            if (document.activeElement && isTextInputElement(document.activeElement)) {
                // Emulate default browser behavior of selecting word the user right clicked.
                selectWordIfSelectionEmpty(event.target);

                const selection = window.getSelection();

                const isTextSelectionDisabled =
                    selection &&
                    selection.anchorNode instanceof Element &&
                    selection.anchorNode === selection.focusNode
                        ? getComputedStyle(selection.anchorNode).userSelect === "none"
                        : false;

                // If you right-click into an element with text selection disabled in a text
                // input (e.g. image files in `<ContentEditor>`) then we shouldn't show text
                // input actions.
                if (!isTextSelectionDisabled) {
                    const isTextSelectedInInput =
                        document.activeElement instanceof HTMLInputElement &&
                        document.activeElement.selectionStart !==
                            document.activeElement.selectionEnd;

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
                            keyboardShortcutHint: isAppleDevice ? "⌘+X" : "Ctrl+X",
                            onPress: () => {
                                document.execCommand("cut");
                            },
                        },
                        {
                            label: "Copy",
                            isDisabled: !isTextSelected,
                            keyboardShortcutHint: isAppleDevice ? "⌘+C" : "Ctrl+C",
                            onPress: () => {
                                document.execCommand("copy");
                            },
                        },
                        {
                            label: "Paste",
                            keyboardShortcutHint: isAppleDevice ? "⌘+V" : "Ctrl+V",
                            onPress: () => {
                                // TODO(calebmer): Enable support for pasting in desktop app wrapper. When we
                                // have a desktop app wrapper also ask the user if they want to install the app
                                // to paste.
                                setShouldShowPasteWarningDialog(true);
                            },
                        },
                    ]);
                }
            }
            // If we right-clicked on selectable text then add our standard text
            // processing actions.
            else if (
                (event.target instanceof HTMLElement &&
                    (getComputedStyle(event.target).userSelect ??
                        // In Safari `user-select` is behind a vendor prefix.
                        getComputedStyle(event.target).webkitUserSelect) !== "none") ||
                // If this is a disabled or read-only input element we allow text
                // processing actions.
                (event.target instanceof HTMLInputElement &&
                    (event.target.disabled || event.target.readOnly))
            ) {
                // Emulate default browser behavior of selecting word the user right clicked.
                selectWordIfSelectionEmpty(event.target);

                const selection = window.getSelection();

                if (
                    event.target instanceof HTMLInputElement ||
                    // If user is right-clicking in the margins of some selectable text (e.g. a
                    // document) don't give them an option to copy. If the right click on a word
                    // then we'll select a word and let them copy.
                    (selection && selection.anchorOffset !== selection.focusOffset)
                ) {
                    actions.unshift([
                        {
                            label: "Copy",
                            keyboardShortcutHint: isAppleDevice ? "⌘+C" : "Ctrl+C",
                            onPress: () => {
                                document.execCommand("copy");
                            },
                        },
                    ]);
                }
            }

            if (actions.length > 0) {
                // Right-clicking may focus an element which may render something (e.g. open a
                // dropdown on focus). Make sure we render our context menu in the same render.
                runWithImmediatePriority(() => {
                    // If the right-clicked element doesn't have an `id` then generate an `id` and
                    // set it on the element.
                    let targetId: string;
                    if (!(event.target instanceof HTMLElement)) {
                        targetId = `ContextMenu:${generateId()}`;
                    } else {
                        if (!event.target.id) {
                            event.target.id = `ContextMenu:${generateId()}`;
                        }
                        targetId = event.target.id;
                    }

                    setContextMenuState({
                        isOpen: true,
                        instance: {
                            x: event.clientX,
                            y: event.clientY,
                            actions,
                            focusedMenuItemIndex: null,
                            targetId,
                        },
                    });
                });
            }
        };

        document.addEventListener("contextmenu", handleContextMenu);
        return () => {
            document.removeEventListener("contextmenu", handleContextMenu);
        };
    }, [isAppleDevice]);

    const [shouldShowPasteWarningDialog, setShouldShowPasteWarningDialog] = useState(false);

    const instance = contextMenuState.isOpen
        ? contextMenuState.instance
        : contextMenuState.lastInstance;

    return (
        <>
            {instance &&
                createPortal(
                    <OverlayAnimated
                        isBlocking={true}
                        isVisible={contextMenuState.isOpen}
                        placement="bottom-start"
                        disableAnimationIn={true}
                        disableAnimationOut={
                            !contextMenuState.isOpen && !contextMenuState.shouldAnimateOut
                        }
                        overlay={
                            <ContextMenu
                                actions={instance.actions}
                                targetId={instance.targetId}
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
                                        lastInstance: null,
                                    });
                                }}
                            />
                        }
                        onActuallyVisibleChange={isActuallyVisible => {
                            if (!isActuallyVisible) {
                                setContextMenuState({
                                    isOpen: false,
                                    shouldAnimateOut: false,
                                    lastInstance: null,
                                });
                            }
                        }}
                    >
                        <Box position="absolute" style={{left: instance.x, top: instance.y}} />
                    </OverlayAnimated>,
                    document.body,
                )}
            {shouldShowPasteWarningDialog && (
                <ModalDialog
                    title={`Can only paste with ${isAppleDevice ? "⌘+V" : "Ctrl+V"}`}
                    description={`For security purposes, your browser only allows pasting with the keyboard shortcut ${
                        isAppleDevice ? "⌘+V" : "Ctrl+V"
                    }. Try again but instead of right clicking use the keyboard shortcut.`}
                    primaryButtonLabel="Ok"
                    onPrimaryButtonPress={() => setShouldShowPasteWarningDialog(false)}
                    shouldHideCancelButton={true}
                    onClose={() => setShouldShowPasteWarningDialog(false)}
                />
            )}
            <IsContextMenuOpenContext.Provider value={!!instance}>
                {children}
            </IsContextMenuOpenContext.Provider>
        </>
    );
}

const ContextMenu = forwardRef(function ContextMenu(
    {
        actions: nestedActions,
        targetId,
        focusedMenuItemIndex,
        onFocusedMenuItemIndexChange,
        onCloseWithAnimation,
        onCloseWithoutAnimation,
    }: {
        actions: ReadonlyArray<ReadonlyArray<MenuAction>>;
        targetId: string;
        focusedMenuItemIndex: number | null;
        onFocusedMenuItemIndexChange: (focusedMenuItemIndex: number | null) => void;
        onCloseWithAnimation: () => void;
        onCloseWithoutAnimation: () => void;
    },
    ref: Ref<HTMLDivElement>,
) {
    const [openedAction, setOpenedAction] = useState<MenuChildrenAction | null>(null);

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

    const lastFocusedMenuItemIndexRef = useRef<number | null>(focusedMenuItemIndex);

    // If a direct descendant was focused then close any open submenu we may have.
    // This will happen if you open a submenu with the keyboard then hover over a
    // different menu item.
    useEffect(() => {
        if (lastFocusedMenuItemIndexRef.current === focusedMenuItemIndex) return;
        lastFocusedMenuItemIndexRef.current = focusedMenuItemIndex;

        const focusedAction =
            focusedMenuItemIndex !== null ? flattenedActions[focusedMenuItemIndex] : undefined;
        setOpenedAction(openedAction =>
            focusedAction?.type === "Action" && focusedAction.action === openedAction
                ? openedAction
                : null,
        );
    }, [flattenedActions, focusedMenuItemIndex]);

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
                            setInteractionModality("keyboard");
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
                        setInteractionModality("keyboard");
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
                            setInteractionModality("keyboard");
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
                        setInteractionModality("keyboard");
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
                        setInteractionModality("keyboard");
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
                        setInteractionModality("keyboard");
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

                    setInteractionModality("keyboard");
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
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }

                // Close our context menu after any unrecognized keypress.
                event.preventDefault();
                event.stopPropagation();
                onCloseWithAnimation();
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
            className={classNames(
                greyElevated2ClassName,
                sprinkles({
                    minWidth: menuSizeConstants.base.desktop.width,
                    borderRadius: "1.5",
                    padding: "1",
                    backgroundColor: "grey-0",
                    boxShadow: "elevation-20",
                }),
            )}
            // The context menu is "owned" by the element on which it opened on top of.
            data-ownedby={targetId}
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
                                openedAction={openedAction}
                                onActionOpen={setOpenedAction}
                                onActionClose={action =>
                                    setOpenedAction(openedAction =>
                                        openedAction === action ? null : openedAction,
                                    )
                                }
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

/**
 * If we have an empty DOM selection then select the word around that selection
 * point using the Unicode word boundary algorithm.
 */
function selectWordIfSelectionEmpty(mouseEventTarget: MouseEvent["target"]) {
    // The DOM selection API doesn't work with `<input>` elements. So if we're
    // selecting inside of an `<input>` element we need to run custom logic.
    if (mouseEventTarget instanceof HTMLInputElement) {
        const inputElement = mouseEventTarget;

        // No input selection.
        if (inputElement.selectionStart === null) return;

        // Selection is not empty.
        if (inputElement.selectionStart !== inputElement.selectionEnd) return;

        const selectionStart = inputElement.selectionStart;
        const textSpans = findUnicodeDefaultWordBoundarySpans(inputElement.value);

        const span = iterableFind(
            textSpans,
            span => span.start <= selectionStart && selectionStart < span.end,
        );

        // Text is probably empty if there's no span.
        if (!span) return;

        inputElement.selectionStart = span.start;
        inputElement.selectionEnd = span.end;
        return;
    }

    const selection = window.getSelection();

    // No DOM selection. Maybe our selection is in an `<input>`?
    if (!selection?.anchorNode) return;

    // Selection is not a text node.
    if (!(selection.anchorNode instanceof Text)) return;

    // Selection is not empty.
    if (selection.anchorOffset !== selection.focusOffset) return;

    const textSpans = findUnicodeDefaultWordBoundarySpans(selection.anchorNode.nodeValue!);

    const span = iterableFind(
        textSpans,
        span => span.start <= selection.anchorOffset && selection.anchorOffset < span.end,
    );

    // Text is probably empty if there's no span.
    if (!span) return;

    const range = document.createRange();
    range.setStart(selection.anchorNode, span.start);
    range.setEnd(selection.anchorNode, span.end);

    selection.removeAllRanges();
    selection.addRange(range);
}
