import {setInteractionModality} from "@react-aria/interactions";
import classNames from "classnames";
import {
    Key,
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
import {createPortal, flushSync} from "react-dom";
import {findSpans as findUnicodeDefaultWordBoundarySpans} from "unicode-default-word-boundary";
import {Box} from "~/client/web/design/box.js";
import {useOutsidePress} from "~/client/web/design/helpers/use_outside_interaction.js";
import {
    Menu,
    MenuAction,
    MenuActionsSection,
    MenuItem,
    MenuStandardAction,
} from "~/client/web/design/menu.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {
    dispatchTriggeredOverlayCloseEvent,
    dispatchTriggeredOverlayOpenEvent,
} from "~/client/web/design/overlay_trigger_button_event_listeners.js";
import {setElementOwnedBy} from "~/client/web/helpers/elements/is_element_owned_by.js";
import {isModifiedKeyboardEvent} from "~/client/web/helpers/events/is_modified_keyboard_event.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useElementWithRef} from "~/client/web/helpers/refs/use_element_with_ref.js";
import {useLifecycleRef} from "~/client/web/helpers/refs/use_lifecycle_ref.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {sprinkles, withoutClearSelectionOnMouseDownClassName} from "~/client/web/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Rectangle} from "~/shared/helpers/geometry/rectangle.js";
import {iterableFind} from "~/shared/helpers/iterable/iterable_find.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";

const contextMenuEventExtensionSymbol = Symbol("contextMenuEventExtension");

type ContextMenuEventExtension = {
    actions?: Array<MenuActionsSection>;
    mergeReadonlyCopyAction?: (
        actions: ReadonlyArray<MenuActionsSection>,
        action: MenuStandardAction,
    ) => ReadonlyArray<MenuActionsSection>;
    extraOverlayBottom?: ReactNode;
    withoutDefaultActions?: boolean;
    withSelectionAlignment?: boolean;
    triggerOverlayOpenElements?: Array<HTMLElement>;
};

/**
 * Add context menu actions to the `contextmenu` `MouseEvent`. Generally prefer
 * using `<ContextMenuActions>` which manages the event for you.
 *
 * Context menu actions are be ordered from most specific to least specific. So
 * if you have:
 *
 * ```jsx
 * <ContextMenuActions actions={actions2}>
 *     <ContextMenuActions actions={actions1}>
 *         ...
 *     </ContextMenuActions>
 * </ContextMenuActions>
 * ```
 *
 * ...the parent's actions should come after the child's actions. So `actions2`
 * should come after `actions1`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function addContextMenuActions(
    event: MouseEvent & {[contextMenuEventExtensionSymbol]?: ContextMenuEventExtension},
    actions: ReadonlyArray<MenuActionsSection>,
    options?: {withoutDefaultActions?: boolean; withSelectionAlignment?: boolean},
) {
    const extension = (event[contextMenuEventExtensionSymbol] ??= {});
    (extension.actions ??= []).push(...actions);
    if (options?.withoutDefaultActions) extension.withoutDefaultActions = true;
    if (options?.withSelectionAlignment) extension.withSelectionAlignment = true;
}

/**
 * Is there an action with the provided `key` in the current context menu
 * actions?
 */
// eslint-disable-next-line react-refresh/only-export-components
export function hasContextMenuActionWithKey(
    event: MouseEvent & {[contextMenuEventExtensionSymbol]?: ContextMenuEventExtension},
    key: Key,
): boolean {
    return (
        event[contextMenuEventExtensionSymbol]?.actions?.some(actions =>
            (isReadonlyArray(actions) ? actions : actions.actions).some(
                action => "key" in action && action.key === key,
            ),
        ) ?? false
    );
}

function setContextMenuMergeReadonlyCopyAction(
    event: MouseEvent & {[contextMenuEventExtensionSymbol]?: ContextMenuEventExtension},
    mergeReadonlyCopyActionSymbol: (
        actions: ReadonlyArray<MenuActionsSection>,
        action: MenuStandardAction,
    ) => ReadonlyArray<MenuActionsSection>,
) {
    const extension = (event[contextMenuEventExtensionSymbol] ??= {});
    extension.mergeReadonlyCopyAction = mergeReadonlyCopyActionSymbol;
}

function setContextMenuExtraOverlayBottom(
    event: MouseEvent & {[contextMenuEventExtensionSymbol]?: ContextMenuEventExtension},
    extraOverlayBottom: ReactNode,
) {
    const extension = (event[contextMenuEventExtensionSymbol] ??= {});
    extension.extraOverlayBottom = extraOverlayBottom;
}

function addContextMenuTriggerOverlayOpenElement(
    event: MouseEvent & {[contextMenuEventExtensionSymbol]?: ContextMenuEventExtension},
    element: HTMLElement,
) {
    const extension = (event[contextMenuEventExtensionSymbol] ??= {});
    extension.triggerOverlayOpenElements ??= [];
    extension.triggerOverlayOpenElements.push(element);
}

/**
 * Create a context menu actions ref if you want to avoid rendering another
 * component with `<ContextMenuActions>` for performance reasons.
 *
 * Context menu actions are be ordered from most specific to least specific. So
 * if you have:
 *
 * ```jsx
 * <ContextMenuActions actions={actions2}>
 *     <ContextMenuActions actions={actions1}>
 *         ...
 *     </ContextMenuActions>
 * </ContextMenuActions>
 * ```
 *
 * ...the parent's actions should come after the child's actions. So `actions2`
 * should come after `actions1`.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useContextMenuActionsRef(
    actionsOrOptions:
        | MaybeThunk<ReadonlyArray<MenuActionsSection>, [MouseEvent]>
        | {
              actions: MaybeThunk<ReadonlyArray<MenuActionsSection>, [MouseEvent]>;
              mergeReadonlyCopyAction?: (
                  actions: ReadonlyArray<MenuActionsSection>,
                  action: MenuStandardAction,
              ) => ReadonlyArray<MenuActionsSection>;
              extraOverlayBottom?: MaybeThunk<ReactNode, [MouseEvent]>;
          }
        | null,
): RefCallback<HTMLElement> {
    const handleContextMenu = useEvent((element: HTMLElement, event: MouseEvent) => {
        if (actionsOrOptions === null) return;

        const {
            actions: actionsOrThunk,
            mergeReadonlyCopyAction,
            extraOverlayBottom: extraOverlayBottomOrThunk,
        } = isReadonlyArray(actionsOrOptions) || typeof actionsOrOptions === "function"
            ? {
                  actions: actionsOrOptions,
                  mergeReadonlyCopyAction: undefined,
                  extraOverlayBottom: undefined,
              }
            : actionsOrOptions;

        const actions =
            typeof actionsOrThunk === "function" ? actionsOrThunk(event) : actionsOrThunk;

        const extraOverlayBottom =
            typeof extraOverlayBottomOrThunk === "function"
                ? extraOverlayBottomOrThunk(event)
                : extraOverlayBottomOrThunk;

        addContextMenuActions(event, actions);

        // If `element` is a `<Button>` then right clicking should show the same
        // selection state the button would be in if it had an open overlay.
        addContextMenuTriggerOverlayOpenElement(event, element);

        if (mergeReadonlyCopyAction !== undefined) {
            setContextMenuMergeReadonlyCopyAction(event, mergeReadonlyCopyAction);
        }

        if (extraOverlayBottom !== undefined) {
            setContextMenuExtraOverlayBottom(event, extraOverlayBottom);
        }
    });

    const lifecycleRef = useCallback(
        (element: HTMLElement) => {
            assert(
                element instanceof HTMLElement,
                "Expected the children of `<ContextMenuActions>` to render an element with a ref to an HTML element",
            );

            const handler = (event: MouseEvent) => {
                handleContextMenu(element, event);
            };

            element.addEventListener("contextmenu", handler);
            return () => {
                element.removeEventListener("contextmenu", handler);
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
 *
 * Context menu actions are be ordered from most specific to least specific. So
 * if you have:
 *
 * ```jsx
 * <ContextMenuActions actions={actions2}>
 *     <ContextMenuActions actions={actions1}>
 *         ...
 *     </ContextMenuActions>
 * </ContextMenuActions>
 * ```
 *
 * ...the parent's actions should come after the child's actions. So `actions2`
 * should come after `actions1`.
 */
export const ContextMenuActions = forwardRef(function ContextMenuActions(
    {
        isDisabled,
        actions,
        mergeReadonlyCopyAction,
        extraOverlayBottom,
        children,
    }: {
        isDisabled?: boolean;
        actions: MaybeThunk<ReadonlyArray<MenuActionsSection>, [MouseEvent]>;
        mergeReadonlyCopyAction?: (
            actions: ReadonlyArray<MenuActionsSection>,
            action: MenuStandardAction,
        ) => ReadonlyArray<MenuActionsSection>;
        extraOverlayBottom?: MaybeThunk<ReactNode, [MouseEvent]>;
        children: ReactElement;
    },
    ref: Ref<HTMLElement>,
) {
    return useElementWithRef(
        children,
        useMergedRefs(
            ref,
            useContextMenuActionsRef(
                !isDisabled
                    ? mergeReadonlyCopyAction !== undefined || extraOverlayBottom !== undefined
                        ? {actions, mergeReadonlyCopyAction, extraOverlayBottom}
                        : actions
                    : null,
            ),
        ),
    );
});

const ContextMenuActionsContext = createContext<ReadonlyArray<MenuActionsSection> | null>(null);

/**
 * Returns true if the context menu is open.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useIsContextMenuOpen(): boolean {
    return useContext(ContextMenuActionsContext) !== null;
}

/**
 * Returns the actions targeted by the context menu. Null if the context
 * menu isn't open.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useContextMenuActions(): ReadonlyArray<MenuActionsSection> | null {
    return useContext(ContextMenuActionsContext);
}

type ContextMenuInstanceState = {
    readonly x: number;
    readonly y: number;
    readonly actions: ReadonlyArray<MenuActionsSection>;
    readonly extraOverlayBottom: ReactNode;
    readonly focusedMenuItemIndex: number | null;
    readonly targetElement: Element;
    readonly triggerOverlayCloseElements: ReadonlyArray<HTMLElement>;
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
            event: MouseEvent & {[contextMenuEventExtensionSymbol]?: ContextMenuEventExtension},
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

            const extension = event[contextMenuEventExtensionSymbol] ?? {};
            let actions: Array<MenuActionsSection> = extension.actions ?? [];
            const {
                mergeReadonlyCopyAction,
                extraOverlayBottom,
                withoutDefaultActions = false,
                withSelectionAlignment = false,
            } = extension;

            // Emulate default browser behavior of selecting word the user right clicked.
            selectWordIfSelectionEmpty(event.target);

            const selection = window.getSelection();

            let target:
                | {type: "Input"; element: HTMLInputElement}
                | {type: "Selection"; selection: Selection}
                | {type: "Node"; node: Node}
                | null = null;

            if (event.target instanceof HTMLInputElement) {
                target = {type: "Input", element: event.target};
            } else if (
                event.target instanceof Node &&
                selection?.containsNode(event.target, true)
            ) {
                target = {type: "Selection", selection};
            } else {
                selection?.empty();
                if (event.target instanceof Node) target = {type: "Node", node: event.target};
            }

            if (target) {
                let isDisabled: boolean;
                let isEditable: boolean;
                let isEmpty: boolean;

                const isDisabledForNode = (node: Node | null) => {
                    if (node === null) return true;

                    const element = !(node instanceof Element) ? node.parentElement : node;
                    if (!element) return true;

                    const userSelect =
                        getComputedStyle(element).userSelect ||
                        // In Safari `user-select` is behind a vendor prefix.
                        getComputedStyle(element).webkitUserSelect;

                    return userSelect === "none";
                };

                switch (target.type) {
                    case "Input": {
                        isDisabled = false;

                        isEditable =
                            target.element === document.activeElement &&
                            !(target.element.disabled || target.element.readOnly);

                        isEmpty = target.element.selectionStart === target.element.selectionEnd;
                        break;
                    }
                    case "Selection": {
                        isDisabled =
                            isDisabledForNode(target.selection.anchorNode) &&
                            isDisabledForNode(target.selection.focusNode);

                        isEditable =
                            document.activeElement instanceof HTMLElement &&
                            document.activeElement.isContentEditable &&
                            target.selection.containsNode(document.activeElement, true);

                        isEmpty =
                            target.selection.anchorNode === target.selection.focusNode &&
                            target.selection.anchorOffset === target.selection.focusOffset;
                        break;
                    }
                    case "Node": {
                        isDisabled = isDisabledForNode(target.node);

                        isEditable =
                            document.activeElement instanceof HTMLElement &&
                            document.activeElement.isContentEditable &&
                            document.activeElement.contains(target.node);

                        isEmpty = true;
                        break;
                    }
                    default:
                        throw exhaustive(target);
                }

                if (!isDisabled && !withoutDefaultActions) {
                    if (!isEditable) {
                        if (!isEmpty) {
                            const action: MenuStandardAction = {
                                label: "Copy",
                                keyboardShortcutHint: isAppleDevice ? "⌘+C" : "Ctrl+C",
                                onPress: () => {
                                    document.execCommand("copy");
                                },
                            };

                            if (mergeReadonlyCopyAction !== undefined) {
                                actions = mergeReadonlyCopyAction(actions, action).slice();
                            } else {
                                actions.unshift([action]);
                            }
                        }
                    } else {
                        actions.unshift([
                            {
                                label: "Cut",
                                isDisabled: isEmpty,
                                keyboardShortcutHint: isAppleDevice ? "⌘+X" : "Ctrl+X",
                                onPress: () => {
                                    document.execCommand("cut");
                                },
                            },
                            {
                                label: "Copy",
                                isDisabled: isEmpty,
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
            }

            if (actions.length > 0 && event.target instanceof Element) {
                const targetElement = event.target;

                const spacingScale = getSpacingScaleWithoutListening();

                let x = event.clientX;
                let y = event.clientY;

                if (withSelectionAlignment) {
                    const selectionRange = selection?.getRangeAt(0);
                    if (selectionRange) {
                        for (const actualRect of selectionRange.getClientRects()) {
                            const rect = Rectangle.from(actualRect);

                            if (rect.containsPoint({x, y})) {
                                x = rect.left;
                                y = rect.bottom + convertRemLengthToPx("1.5", spacingScale);
                                break;
                            }
                        }
                    }
                }

                // Right-clicking may focus an element which may render something (e.g. open a
                // dropdown on focus). Make sure we render our context menu in the same render.
                flushSync(() => {
                    const triggerOverlayOpenElements = extension.triggerOverlayOpenElements ?? [];

                    for (const element of triggerOverlayOpenElements) {
                        dispatchTriggeredOverlayOpenEvent(element);
                    }

                    setContextMenuState({
                        isOpen: true,
                        instance: {
                            x,
                            y,
                            actions,
                            extraOverlayBottom,
                            focusedMenuItemIndex: null,
                            targetElement,
                            triggerOverlayCloseElements: triggerOverlayOpenElements,
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

    const previousContextMenuStateRef = useRef<ContextMenuState | null>(null);

    // Call `dispatchTriggeredOverlayCloseEvent()` once the context menu closes on
    // any elements we had called `dispatchTriggeredOverlayOpenEvent()` on.
    useEffect(() => {
        if ((previousContextMenuStateRef.current ?? null) === contextMenuState) return;

        const previousContextMenuState = previousContextMenuStateRef.current;
        previousContextMenuStateRef.current = contextMenuState;

        const previousInstance = previousContextMenuState?.isOpen
            ? previousContextMenuState.instance
            : (previousContextMenuState?.lastInstance ?? null);

        const instance = contextMenuState.isOpen
            ? contextMenuState.instance
            : contextMenuState.lastInstance;

        if (
            previousInstance !== null &&
            previousInstance?.triggerOverlayCloseElements !== instance?.triggerOverlayCloseElements
        ) {
            for (const element of previousInstance.triggerOverlayCloseElements) {
                // Double request animation frame on close (when animating) like
                // `<OverlayTriggerButton>`. See the documentation comment in
                // `<OverlayTriggerButton>` around its `dispatchTriggeredOverlayCloseEvent()`
                // call for more details on why we need a double animation frame.
                if (
                    !previousContextMenuState?.isOpen &&
                    !previousContextMenuState?.shouldAnimateOut
                ) {
                    dispatchTriggeredOverlayCloseEvent(element);
                } else {
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            dispatchTriggeredOverlayCloseEvent(element);
                        });
                    });
                }
            }
        }
    }, [contextMenuState, instance]);

    // Set the target of our `<OverlayAnimated>` to be owned by the element the
    // user right clicked on. This way we won't consider events in the context menu
    // to be outside the target element.
    //
    // We need to use `setElementOwnedBy()` instead of the `data-ownedby` attribute
    // because we can't add an `id` to arbitrary elements in the DOM. For example,
    // an element in a ProseMirror `EditorView` will immediately remove any
    // unexpected DOM changes.
    const instanceTargetRef = useLifecycleRef<HTMLDivElement>(
        useCallback(
            element => {
                setElementOwnedBy(element, instance?.targetElement ?? null);
                return () => {
                    setElementOwnedBy(element, null);
                };
            },
            [instance?.targetElement],
        ),
    );

    return (
        <>
            {instance &&
                createPortal(
                    <OverlayAnimated
                        // The context menu needs to render over other blocking overlays (e.g.
                        // `<Modal>`s) so it gets its own special blocking level.
                        isBlocking="ContextMenu"
                        isVisible={contextMenuState.isOpen}
                        placement="bottom-start"
                        disableAnimationIn={true}
                        disableAnimationOut={
                            !contextMenuState.isOpen && !contextMenuState.shouldAnimateOut
                        }
                        overlay={
                            <ContextMenu
                                actions={instance.actions}
                                extraBottom={instance.extraOverlayBottom}
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
                        <Box
                            ref={instanceTargetRef}
                            position="absolute"
                            style={{left: instance.x, top: instance.y}}
                        />
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
            <ContextMenuActionsContext.Provider value={instance?.actions ?? null}>
                {children}
            </ContextMenuActionsContext.Provider>
        </>
    );
}

const ContextMenu = forwardRef(function ContextMenu(
    {
        actions: nestedActions,
        extraBottom,
        focusedMenuItemIndex,
        onFocusedMenuItemIndexChange,
        onCloseWithAnimation,
        onCloseWithoutAnimation,
    }: {
        actions: ReadonlyArray<MenuActionsSection>;
        extraBottom: ReactNode;
        focusedMenuItemIndex: number | null;
        onFocusedMenuItemIndexChange: (focusedMenuItemIndex: number | null) => void;
        onCloseWithAnimation: () => void;
        onCloseWithoutAnimation: () => void;
    },
    ref: Ref<HTMLDivElement>,
) {
    const [openedActionKey, setOpenedActionKey] = useState<Key | null>(null);

    const flattenedActions = useMemo(() => {
        const flattenedActions: Array<
            | {type: "Action"; action: MenuAction}
            | {type: "Divider"}
            | {type: "Heading"; heading: string}
        > = [];

        for (const nestedAction of nestedActions) {
            if (flattenedActions.length > 0) {
                flattenedActions.push({type: "Divider"});
            }

            if (!isReadonlyArray(nestedAction)) {
                flattenedActions.push({type: "Heading", heading: nestedAction.heading});
            }

            for (const action of isReadonlyArray(nestedAction)
                ? nestedAction
                : nestedAction.actions) {
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
        setOpenedActionKey(openedActionKey =>
            focusedAction?.type === "Action" &&
            focusedAction.action.hasChildren &&
            focusedAction.action.key === openedActionKey
                ? openedActionKey
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
    //
    // TODO(calebmer): This doesn't support `ArrowRight` keyboard events when the
    // context menu includes a children action. Ideally I'd find a way to refactor
    // `<Menu>` in a way where its `onKeyDown` logic works with global key down
    // events when there's no focus.
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
                event.preventDefault(); // Don't scroll
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
        <OverlayScopeContextProvider>
            <div
                ref={useMergedRefs<HTMLDivElement>(ref, useOutsidePress(onCloseWithAnimation))}
                data-testid="ContextMenu"
                className={classNames(
                    greyElevated2ClassName,
                    // If the user clicks on a non-clickable area of the context menu it shouldn't
                    // deselect the text the context menu is targeting.
                    withoutClearSelectionOnMouseDownClassName,
                    sprinkles({
                        minWidth: Menu.sizeConstants.base.desktop.width,
                        borderRadius: "1.5",
                        padding: "1",
                        backgroundColor: "grey-0",
                        boxShadow: "elevation-20",
                    }),
                )}
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
                        case "Heading": {
                            return (
                                <Box
                                    key={index}
                                    paddingTop="1.5"
                                    paddingBottom="1"
                                    paddingX="2"
                                    color="grey-50"
                                    fontSize="50"
                                >
                                    {action.heading}
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
                                    openedActionKey={openedActionKey}
                                    onActionOpen={action => setOpenedActionKey(action.key)}
                                    onActionClose={action =>
                                        setOpenedActionKey(openedActionKey =>
                                            openedActionKey === action.key ? null : openedActionKey,
                                        )
                                    }
                                />
                            );
                        }
                        default:
                            throw exhaustive(action);
                    }
                })}
                {extraBottom}
            </div>
        </OverlayScopeContextProvider>
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

    // If the selection doesn't intersect our event target don't expand it.
    if (!(mouseEventTarget instanceof Node)) return;
    if (selection && !selection.containsNode(mouseEventTarget, true)) return;

    // Selection is not a text node.
    if (!(selection.anchorNode instanceof Text)) return;

    // Selection is not empty.
    if (
        selection.anchorNode !== selection.focusNode ||
        selection.anchorOffset !== selection.focusOffset
    ) {
        return;
    }

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
