import {setInteractionModality} from "@react-aria/interactions";
import React, {
    ReactElement,
    Ref,
    createRef,
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {
    getNextFocusableElement,
    getPreviousFocusableElement,
} from "~/client/design/helpers/get_next_focusable_element";
import {setElementAttributesWithCleanup} from "~/client/design/helpers/set_element_attributes_with_cleanup";
import {useElementWithRef} from "~/client/design/helpers/use_element_with_ref";
import {useLifecycleRef} from "~/client/design/helpers/use_lifecycle_ref";
import {useMergedRefs} from "~/client/design/helpers/use_merged_refs";
import {Overlay, OverlayPlacement} from "~/client/design/overlay";
import {uninterruptedThoughtLimitMs} from "~/client/design/timing_constants";
import {
    Tooltip,
    TooltipCoordinationContextProvider,
    defaultTooltipOffset,
    useShouldDisableTooltips,
} from "~/client/design/tooltip";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {Spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {
    overlayAnimateContainerClassName,
    overlayAnimateFadeOutClassName,
    overlayFadeOutAnimationDurationMs,
} from "~/shared/styles/styles";

// TODO(calebmer): Implement the mobile action sheet version of our menu
// component.

/**
 * A single action in a menu.
 */
export type MenuAction = {
    /**
     * What label do we present to the user for this action?
     *
     * Every action must have a unique label because we also use this string,
     * internally, as the key for our actions.
     */
    readonly label: string;

    /**
     * Is this action disabled? If so, for what reason? We will display the reason
     * as a tooltip if the user tries to interact with a disabled action. Disabled
     * actions may not be selected.
     */
    readonly disabledReason?: string;

    /**
     * Should we render this with a destructive action treatment?
     */
    readonly isDestructive?: boolean;

    /**
     * When the user chooses this action through either the keyboard or mouse we
     * will call this handler.
     */
    readonly onPress: () => void;
};

type MenuButtonState =
    | {
          readonly isExpanded: false;
          readonly isFadingOut: boolean;
          readonly initiallyFocus?: undefined;
      }
    | {
          readonly isExpanded: true;
          readonly initiallyFocus?: "FirstMenuItem" | "LastMenuItem";
          readonly isFadingOut?: undefined;
      };

const initialMenuButtonState: MenuButtonState = {
    isExpanded: false,
    isFadingOut: false,
};

type MenuButtonChildrenProps = {
    /**
     * Is the menu currently visible? True even while the menu is fading out.
     */
    isVisible: boolean;
};

/**
 * A menu button is a button which opens a menu overlay. The menu overlay
 * contains a list of actions which may be selected by the user.
 *
 * Implements the [WAI-ARIA menu button pattern][1].
 *
 * [1]: https://www.w3.org/TR/wai-aria-practices-1.2/#menubutton
 */
export function MenuButton({
    actions,
    placement = "bottom-start",
    offset = defaultTooltipOffset,
    children: actualChildren,
    onStateChange: _onStateChange,
}: {
    /**
     * All the actions available in a menu’s popup. When clicking on the button
     * element to open
     */
    actions: ReadonlyArray<MenuAction>;

    /**
     * Where should the menu overlay be placed relative to the target element?
     * Defaults to `bottom-start`.
     */
    placement?: OverlayPlacement;

    /**
     * Offset of the menu from the target.
     *
     * Defaults to the same thing as tooltips.
     */
    offset?: Spacing;

    /**
     * The button element which opens and closes the menu. Must provide a ref to
     * an HTML `<button>` element or we will throw an error.
     */
    children: ReactElement | ((props: MenuButtonChildrenProps) => ReactElement);

    /**
     * Observe the menu's internal state.
     */
    onStateChange?: (state: MenuButtonState) => void;
}) {
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const [state, setState] = useState(initialMenuButtonState);

    const onStateChange = useEvent(_onStateChange);
    useEffect(() => {
        onStateChange(state);
    }, [onStateChange, state]);

    // Make sure to unset `state.isFadingOut` once the fade-out duration has
    // finished. That way we actually unmount the menu in the DOM.
    useEffect(() => {
        if (state.isExpanded || !state.isFadingOut) return;

        const timeout = createTimeout(() => {
            setState(oldState => {
                if (oldState.isExpanded) return oldState;
                return {...oldState, isFadingOut: false};
            });
        }, overlayFadeOutAnimationDurationMs);

        return () => {
            timeout.clear();
        };
    }, [state.isExpanded, state.isFadingOut]);

    const menuButtonLifecycleRef = useCallback(
        (menuButtonElement: HTMLButtonElement) => {
            // We require an HTML `<button>` element for accessibility. Another option
            // is allowing arbitrary HTML elements that have the appropriate role and
            // tab-index.
            assert(
                menuButtonElement instanceof HTMLButtonElement,
                "Expected the children of `<MenuButton>` to render an element with a ref to an HTML `<button>` element",
            );

            assert(!state.isExpanded || menuRef.current);
            const menuElement = menuRef.current;

            // - With focus on the button:
            //   - Enter: opens the menu and places focus on the first menu item.
            //   - Space: Opens the menu and places focus on the first menu item.
            //   - (Optional) Down Arrow: opens the menu and moves focus to the first menu item.
            //   - (Optional) Up Arrow: opens the menu and moves focus to the last menu item.
            //
            // https://www.w3.org/TR/wai-aria-practices-1.2/#keyboard-interaction-13
            function handleKeyDown(event: KeyboardEvent) {
                switch (event.key) {
                    case "ArrowDown": {
                        event.preventDefault(); // Don’t scroll
                        setState({isExpanded: true, initiallyFocus: "FirstMenuItem"});
                        break;
                    }
                    case "ArrowUp": {
                        event.preventDefault(); // Don’t scroll
                        setState({isExpanded: true, initiallyFocus: "LastMenuItem"});
                        break;
                    }
                    case "Enter": {
                        setState({isExpanded: true, initiallyFocus: "FirstMenuItem"});
                        break;
                    }
                    case " ": {
                        event.preventDefault(); // Don’t scroll
                        setState({isExpanded: true, initiallyFocus: "FirstMenuItem"});
                        break;
                    }
                    default:
                        break;
                }
            }

            function handlePointerDown(event: MouseEvent) {
                if (isRightClick(event)) return;

                setState(oldState => {
                    if (!oldState.isExpanded) {
                        return {isExpanded: true};
                    } else {
                        return {
                            isExpanded: false,
                            // Don't animate the menu out when the user took a direct action to close
                            // the menu.
                            isFadingOut: false,
                        };
                    }
                });
            }

            const menuId = menuElement?.getAttribute("id") ?? null;

            const menuButtonId =
                menuButtonElement.getAttribute("id") ??
                (menuId !== null ? `${menuId}-button` : null);

            const cleanupMenuButtonAttributes = setElementAttributesWithCleanup(menuButtonElement, {
                // If the button already has an ID, we won’t override that.
                id: menuButtonId,
                // - The element that opens the menu has role button.
                // - The element with role `button` has `aria-haspopup` set to either
                //   `"menu"` or `true`.
                // - When the menu is displayed, the element with role button has
                //   `aria-expanded` set to true. When the menu is hidden, it is
                //   recommended that `aria-expanded` is not present. If
                //   `aria-expanded` is specified when the menu is hidden, it is set
                //   to false.
                // - The element that contains the menu items displayed by activating
                //   the button has role `menu`.
                // - Optionally, the element with role `button` has a value specified
                //   for `aria-controls` that refers to the element with role `menu`.
                //
                // https://www.w3.org/TR/wai-aria-practices-1.2/#menubutton
                "aria-haspopup": "menu",
                "aria-expanded": state.isExpanded ? "true" : null,
                "aria-controls": menuId,
            });

            const cleanupMenuAttributes = menuElement
                ? setElementAttributesWithCleanup(menuElement, {
                      // An element with role menu has `aria-labelledby` set to a value
                      // that refers to the button that controls its display.
                      //
                      // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                      //
                      // We have to set this in our lifecycle ref because we don’t have
                      // the button’s ID at render time.
                      "aria-labelledby": menuButtonId,
                  })
                : null;

            // Needs to be capture phase because `usePress()` will prevent default and stop
            // propagation on press events.
            menuButtonElement.addEventListener("pointerdown", handlePointerDown, {capture: true});
            menuButtonElement.addEventListener("keydown", handleKeyDown);

            return () => {
                cleanupMenuButtonAttributes();
                cleanupMenuAttributes?.();

                menuButtonElement.removeEventListener("pointerdown", handlePointerDown, {
                    capture: true,
                });
                menuButtonElement.removeEventListener("keydown", handleKeyDown);
            };
        },
        [state.isExpanded],
    );

    // Close the menu if there’s a click somewhere else in the document outside
    // the menu or menu button.
    useEffect(() => {
        if (!state.isExpanded) return;

        function handleDocumentMouseDown(event: MouseEvent) {
            const menuButtonElement = menuButtonRef.current;
            const menuElement = menuRef.current;
            const targetElement = event.target as Element;

            if (menuButtonElement?.contains(targetElement)) return;
            if (menuElement?.contains(targetElement)) return;

            setState({isExpanded: false, isFadingOut: true});
        }

        document.addEventListener("mousedown", handleDocumentMouseDown);
        return () => {
            document.removeEventListener("mousedown", handleDocumentMouseDown);
        };
    }, [state.isExpanded]);

    const isVisible = state.isExpanded || state.isFadingOut;

    const children = useElementWithRef(
        useMemo(() => {
            if (typeof actualChildren !== "function") {
                return actualChildren;
            } else {
                return actualChildren({isVisible});
            }
        }, [actualChildren, isVisible]),
        useMergedRefs(menuButtonRef, useLifecycleRef(menuButtonLifecycleRef)),
    );

    return (
        <Overlay
            isVisible={isVisible}
            placement={placement}
            offset={offset}
            overlay={
                <Menu
                    ref={menuRef}
                    actions={actions}
                    placement={placement}
                    isFadingOut={!state.isExpanded && state.isFadingOut}
                    initiallyFocus={state.initiallyFocus ?? "Menu"}
                    onClose={({returnFocusTo} = {}) => {
                        setState({isExpanded: false, isFadingOut: true});

                        const menuButtonElement = assertExists(menuButtonRef.current);

                        switch (returnFocusTo) {
                            case "TriggerElement": {
                                menuButtonElement.focus();
                                break;
                            }
                            case "NextElement": {
                                getNextFocusableElement(menuButtonElement)?.focus();
                                break;
                            }
                            case "PreviousElement": {
                                getPreviousFocusableElement(menuButtonElement)?.focus();
                                break;
                            }
                            case undefined: {
                                break;
                            }
                            default:
                                throw exhaustive(returnFocusTo);
                        }
                    }}
                />
            }
        >
            {children}
        </Overlay>
    );
}

/**
 * A menu offers a list of actions to a user. A menu is rendered as an overlay
 * on top of the application.
 *
 * Implements the [WAI-ARIA menu pattern][1].
 *
 * [1]: https://www.w3.org/TR/wai-aria-practices-1.2/#menu
 */
const Menu = forwardRef(function Menu(
    {
        actions,
        placement,
        isFadingOut,
        initiallyFocus,
        onClose,
    }: {
        actions: ReadonlyArray<MenuAction>;
        placement: OverlayPlacement;
        isFadingOut: boolean;
        initiallyFocus: "Menu" | "FirstMenuItem" | "LastMenuItem";
        onClose: (opts?: {
            returnFocusTo?: "TriggerElement" | "NextElement" | "PreviousElement";
        }) => void;
    },
    ref: Ref<HTMLDivElement>,
) {
    assert(actions.length > 0);

    const menuRef = useRef<HTMLDivElement>(null);

    const menuItemRefs = useMemo(() => actions.map(() => createRef<HTMLDivElement>()), [actions]);

    // When a `menu` opens, keyboard focus is placed on the first item.
    //
    // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
    useEffect(() => {
        switch (initiallyFocus) {
            case "Menu":
                menuRef.current?.focus();
                break;
            case "FirstMenuItem":
                menuItemRefs[0]!.current?.focus();
                break;
            case "LastMenuItem":
                menuItemRefs[menuItemRefs.length - 1]!.current?.focus();
                break;
            default:
                throw exhaustive(initiallyFocus);
        }

        // Intentionally first render only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [searchText, setSearchText] = useState("");

    // We want to reset the search text back to an empty string after some period
    // of time whenever it changes.
    useEffect(() => {
        if (searchText === "") return;

        const timeout = createTimeout(() => {
            setSearchText("");
        }, uninterruptedThoughtLimitMs);

        return () => {
            timeout.clear();
        };
    }, [searchText]);

    function getFocusedActionIndex() {
        if (!document.activeElement) return null;
        const index = menuItemRefs.findIndex(
            menuItemRef => menuItemRef.current === document.activeElement,
        );
        return index === -1 ? null : index;
    }

    function setAriaActiveDescendant(event: React.FocusEvent<HTMLDivElement>) {
        const menuElement = event.currentTarget;

        const activeIndex = getFocusedActionIndex();
        const activeMenuItemId =
            activeIndex !== null
                ? menuItemRefs[activeIndex]!.current?.getAttribute("id") ?? null
                : null;

        if (activeMenuItemId !== null) {
            menuElement.setAttribute("aria-activedescendant", activeMenuItemId);
        } else {
            menuElement.removeAttribute("aria-activedescendant");
        }
    }

    // While the menu is open, we want to disable all other tooltips in the
    // application.
    useShouldDisableTooltips();

    return (
        // While tooltips are disabled outside our menu, we still want to allow
        // tooltips within our menu.
        <TooltipCoordinationContextProvider>
            <div
                ref={useMergedRefs(menuRef, ref)}
                role="menu"
                // The menu container has `tabindex` set to -1 or 0 and
                // `aria-activedescendant` set to the ID of the focused item.
                //
                // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                tabIndex={-1}
                className={overlayAnimateContainerClassName}
                onFocus={setAriaActiveDescendant}
                onBlur={setAriaActiveDescendant}
                onKeyDown={event => {
                    if (isFadingOut) return;

                    switch (event.key) {
                        // When focus is in a menu, moves focus to the next item, optionally
                        // wrapping from the last to the first.
                        //
                        // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                        case "ArrowDown": {
                            event.preventDefault(); // Don’t scroll

                            setInteractionModality("keyboard");

                            const currentIndex = getFocusedActionIndex();
                            if (currentIndex === null) {
                                menuItemRefs[0]!.current?.focus();
                                break;
                            }

                            let nextIndex = currentIndex + 1;
                            if (nextIndex > menuItemRefs.length - 1) nextIndex = 0;

                            menuItemRefs[nextIndex]!.current?.focus();
                            break;
                        }
                        // When focus is in a menu, moves focus to the previous item,
                        // optionally wrapping from the first to the last.
                        //
                        // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                        case "ArrowUp": {
                            event.preventDefault(); // Don’t scroll

                            setInteractionModality("keyboard");

                            const currentIndex = getFocusedActionIndex();
                            if (currentIndex === null) {
                                menuItemRefs[menuItemRefs.length - 1]!.current?.focus();
                                break;
                            }

                            let nextIndex = currentIndex - 1;
                            if (nextIndex < 0) nextIndex = menuItemRefs.length - 1;

                            menuItemRefs[nextIndex]!.current?.focus();
                            break;
                        }
                        // Close the menu that contains focus and return focus to the element
                        // or context, e.g., menu button, from which the menu was opened.
                        //
                        // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                        case "Escape": {
                            onClose({returnFocusTo: "TriggerElement"});
                            break;
                        }
                        // Moves focus to the next (or previous) element in the tab sequence,
                        // and closes its `menu` and all open parent menu containers.
                        //
                        // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                        case "Tab": {
                            event.preventDefault();
                            onClose({
                                returnFocusTo: event.shiftKey ? "PreviousElement" : "NextElement",
                            });
                            break;
                        }
                        default: {
                            // Move focus to the next menu item in the current menu whose label
                            // begins with that printable character.
                            //
                            // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                            if (/^[0-9a-zA-Z]$/.test(event.key)) {
                                const nextSearchText = searchText + event.key;
                                const nextIndex = actions.findIndex(
                                    action =>
                                        action.label
                                            .slice(0, nextSearchText.length)
                                            .toLowerCase() === nextSearchText.toLowerCase(),
                                );
                                if (nextIndex !== -1) menuItemRefs[nextIndex]!.current?.focus();
                                setSearchText(nextSearchText);
                                break;
                            }
                        }
                    }
                }}
            >
                <Box
                    width="32"
                    borderRadius="md"
                    padding="1"
                    backgroundColor={{light: "grey-0", dark: "grey-5"}}
                    boxShadow="elevation-20"
                    className={isFadingOut ? overlayAnimateFadeOutClassName : undefined}
                >
                    {actions.map((action, index) => {
                        return (
                            <MenuItem
                                key={index}
                                ref={menuItemRefs[index]}
                                action={action}
                                parentPlacement={placement}
                                isFadingOut={isFadingOut}
                                onClose={onClose}
                            />
                        );
                    })}
                </Box>
            </div>
        </TooltipCoordinationContextProvider>
    );
});

const MenuItem = forwardRef(function MenuItem(
    {
        action,
        parentPlacement,
        isFadingOut,
        onClose,
    }: {
        action: MenuAction;
        parentPlacement: OverlayPlacement;
        isFadingOut: boolean;
        onClose: () => void;
    },
    ref: Ref<HTMLDivElement>,
) {
    if (action.disabledReason !== undefined) {
        return (
            <Tooltip
                placement={
                    parentPlacement.startsWith("left") ||
                    parentPlacement === "top-end" ||
                    parentPlacement === "bottom-end"
                        ? "left"
                        : "right"
                }
                content={action.disabledReason}
            >
                {({skipHoverDelay}) => (
                    <MenuButtonInner
                        innerRef={ref}
                        action={action}
                        parentPlacement={parentPlacement}
                        isFadingOut={isFadingOut}
                        onClose={onClose}
                        skipHoverDelay={skipHoverDelay}
                    />
                )}
            </Tooltip>
        );
    } else {
        return (
            <MenuButtonInner
                innerRef={ref}
                action={action}
                parentPlacement={parentPlacement}
                isFadingOut={isFadingOut}
                onClose={onClose}
            />
        );
    }
});

function MenuButtonInner({
    innerRef,
    action,
    parentPlacement,
    isFadingOut,
    onClose,
    skipHoverDelay,
}: {
    innerRef: Ref<HTMLDivElement>;
    action: MenuAction;
    parentPlacement: OverlayPlacement;
    isFadingOut: boolean;
    onClose: () => void;
    skipHoverDelay?: () => void;
}) {
    const menuItemId = useId();
    const isDisabled = action.disabledReason !== undefined;

    const {isHovered, hoverProps} = useHover({
        isDisabled,
        // When the mouse hovers over a menu item, we focus it so if the user
        // then uses the keyboard (presses enter or an arrow key) we navigate
        // using the hovered menu item.
        onHoverStart: event => event.target.focus(),
        onHoverEnd: event => event.target.blur(),
    });

    const {isPressed, pressProps} = usePress({
        isDisabled: isFadingOut,
        onPress: () => {
            if (isDisabled) {
                skipHoverDelay?.();
            } else {
                onClose();
                action.onPress();
            }
        },
    });

    return (
        <FocusRing offset="0">
            <Box
                {...mergeProps(hoverProps, pressProps)}
                ref={innerRef}
                id={menuItemId}
                role="menuitem"
                // Each item in the menu has `tabindex` set to -1. (Even disabled items
                // are focusable.)
                //
                // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                tabIndex={-1}
                paddingX="2"
                paddingY="1"
                borderRadius="base"
                color={isDisabled ? "grey-40" : action.isDestructive ? "red-50" : "grey-text"}
                backgroundColor={isPressed ? "grey-10" : isHovered ? "grey-5" : undefined}
                // When a menu item is disabled, `aria-disabled` is set to true.
                //
                // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                aria-disabled={isDisabled ? true : undefined}
            >
                {action.label}
            </Box>
        </FocusRing>
    );
}

function isRightClick(event: MouseEvent) {
    return event.which === 3 || event.button === 2;
}
