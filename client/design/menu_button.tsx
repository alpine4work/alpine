import {setInteractionModality} from "@react-aria/interactions";
import classNames from "classnames";
import {Check, IconContext, SpinnerGap} from "phosphor-react";
import {
    ReactElement,
    ReactNode,
    Ref,
    createRef,
    forwardRef,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {OverlayPlacement} from "~/client/design/overlay.js";
import {
    OverlayTriggerButton,
    OverlayTriggerButtonChildrenProps,
    OverlayTriggerButtonRef,
    OverlayTriggerButtonState,
} from "~/client/design/overlay_trigger_button.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {delayLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useShowToast} from "~/client/design/toast.js";
import {Tooltip, defaultTooltipOffset} from "~/client/design/tooltip.js";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {Spacing, spacing} from "~/shared/design/spacing.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    colorSchemeVars,
    greyElevated2ClassName,
    spinAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles.js";

/**
 * A single action in a menu.
 */
export type MenuAction = MenuStandardAction | MenuCustomAction;

type MenuStandardAction = {
    /**
     * What label do we present to the user for this action?
     *
     * Every action must have a unique label because we also use this string,
     * internally, as the key for our actions.
     */
    readonly label: string;

    /**
     * An optional icon element rendered next to the action label.
     */
    readonly icon?: ReactNode | ((props: {size: "3" | "4"; isDisabled: boolean}) => ReactNode);

    /**
     * Is the icon at the front or back of the menu item? Defaults to `start`.
     */
    readonly iconPlacement?: "start" | "end";

    /**
     * Render a checkmark next to this action since it is already selected.
     */
    readonly isSelected?: boolean;

    /**
     * Is the action disabled? Does not display a reason tooltip like when you use
     * `disabledReason`. Generally you should prefer `disabledReason`. If you set
     * `disabledReason` then you don't have to set `isDisabled`. Disabled actions
     * may not be selected.
     */
    readonly isDisabled?: boolean;

    /**
     * Is this action disabled? If so, for what reason? We will display the reason
     * as a tooltip if the user tries to interact with a disabled action. Disabled
     * actions may not be selected.
     */
    readonly disabledReason?: string;

    /**
     * A keyboard shortcut that will display next to the menu item.
     */
    readonly keyboardShortcutHint?: ReactNode;

    /**
     * When the user chooses this action through either the keyboard or mouse we
     * will call this handler.
     *
     * If a promise is returned we will show a loading spinner while waiting for
     * the promise to resolve. If you return a promise you must pass in a
     * `pressErrorTitle` property to communicate to the user what failed after
     * the press.
     */
    readonly onPress: () => void | Promise<void>;

    /**
     * If an error occurs while running `onPress` we will report the error to the user with
     * this title. It is the "what happened" part of an error message according to [Adobe
     * Spectrum's][1] error content guidelines.
     *
     * So for example it this is a delete comment action say "Couldn’t delete comment".
     *
     * Required when the `onPress` event returns a promise.
     *
     * [1]: https://spectrum.adobe.com/page/writing-for-errors
     */
    readonly pressErrorTitle?: string;

    readonly withCustomLayout?: undefined;
};

type MenuCustomAction = {
    /**
     * If the standard action props are not enough for you then you can provide
     * your own, custom, React renderer for menu actions.
     *
     * However, doing so means you lose some standard functionality! Including:
     *
     * - Search for action by name by pressing letter keys (e.g. "e" jumps you
     *   to "Edit")
     * - Disabled states
     *
     * Otherwise custom menu actions still have correct accessibility properties
     * and can be keyboard navigated.
     */
    readonly withCustomLayout: true;

    /**
     * Called when this action is activated either by mouse or by keyboard.
     *
     * If a promise is returned we will show a loading spinner while waiting for
     * the promise to resolve. If you return a promise you must pass in a
     * `pressErrorTitle` property to communicate to the user what failed after
     * the press.
     */
    readonly onPress: () => void | Promise<void>;

    /**
     * If an error occurs while running `onPress` we will report the error to the user with
     * this title. It is the "what happened" part of an error message according to [Adobe
     * Spectrum's][1] error content guidelines.
     *
     * So for example it this is a delete comment action say "Couldn’t delete comment".
     *
     * Required when the `onPress` event returns a promise.
     *
     * [1]: https://spectrum.adobe.com/page/writing-for-errors
     */
    readonly pressErrorTitle?: string;

    /**
     * Custom renderer for your menu action.
     */
    readonly render: (props: {
        isPressed: boolean;
        isHovered: boolean;
        shouldShowPendingSpinner: boolean;
    }) => ReactNode;
};

export type MenuSize = "base" | "lg" | "xl";
export type MenuMaxHeight = "48" | "64" | "96";

export const menuSizeConstants: {
    [Key in MenuSize]: {
        [Key in "desktop" | "mobile"]: {
            width: Spacing;
            iconSize: "3" | "4";
            itemPaddingY: Spacing;
        };
    };
} = {
    base: {
        desktop: {
            width: "32",
            iconSize: "3",
            itemPaddingY: "1",
        },
        mobile: {
            width: "48",
            iconSize: "4",
            itemPaddingY: "1.5",
        },
    },
    lg: {
        desktop: {
            width: "48",
            iconSize: "3",
            itemPaddingY: "1",
        },
        mobile: {
            width: "64",
            iconSize: "4",
            itemPaddingY: "1.5",
        },
    },
    xl: {
        desktop: {
            width: "64",
            iconSize: "4",
            itemPaddingY: "1.5",
        },
        mobile: {
            width: "64",
            iconSize: "4",
            itemPaddingY: "1.5",
        },
    },
};

type MenuActions = ReadonlyArray<MenuAction | ReadonlyArray<MenuAction>>;

const MenuButtonForwardRef = forwardRef(MenuButton);
export {MenuButtonForwardRef as MenuButton};

/**
 * A menu button is a button which opens a menu overlay. The menu overlay
 * contains a list of actions which may be selected by the user.
 *
 * Implements the [WAI-ARIA menu button pattern][1].
 *
 * [1]: https://www.w3.org/TR/wai-aria-practices-1.2/#menubutton
 */
function MenuButton(
    {
        actions,
        placement = "bottom-start",
        size = "base",
        maxHeight,
        offset = defaultTooltipOffset,
        offsetAlong,
        children,
        onStateChange,
        shouldNotCloseAfterActionPress,
        extraOverlayBottom,
    }: {
        /**
         * All the actions available in a menu’s popup. When clicking on the button
         * element to open
         *
         * If you have nested arrays then each sub-array will form a section with a
         * divider between sections.
         */
        actions: MenuActions | (() => MenuActions);

        /**
         * Where should the menu overlay be placed relative to the target element?
         * Defaults to `bottom-start`.
         */
        placement?: OverlayPlacement;

        /**
         * The size of our menu. Defaults to `base`.
         *
         * On mobile, `base` menus get larger to accommodate less precise input
         * mechanisms (fingers). Items grow to `lg` size even if the menu width as a
         * whole doesn't.
         */
        size?: MenuSize;

        /**
         * The maximum height of the menu. If none is provided the menu will grow
         * indefinitely.
         */
        maxHeight?: MenuMaxHeight;

        /**
         * Offset of the menu from the target.
         *
         * Defaults to the same thing as tooltips.
         */
        offset?: Spacing;

        /**
         * How far the offset should move along the reference.
         *
         * See the [demo][1] here.
         *
         * [1]: https://popper.js.org/docs/v2/modifiers/offset/#demo
         */
        offsetAlong?: Spacing | `-${Spacing}`;

        /**
         * Should not close the menu after an action is pressed.
         */
        shouldNotCloseAfterActionPress?: boolean;

        /**
         * Some extra DOM to put at the bottom of the menu overlay. Useful if you
         * need some particularly custom in your menu.
         */
        extraOverlayBottom?: ReactNode;

        /**
         * The button element which opens and closes the menu. Must provide a ref to
         * an HTML `<button>` element or we will throw an error.
         */
        children: ReactElement | ((props: OverlayTriggerButtonChildrenProps) => ReactElement);

        /**
         * Observe the menu's internal state.
         */
        onStateChange?: (state: OverlayTriggerButtonState) => void;
    },
    ref: Ref<OverlayTriggerButtonRef>,
) {
    return (
        <OverlayTriggerButton
            ref={ref}
            aria-haspopup="menu"
            placement={placement}
            offset={offset}
            offsetAlong={offsetAlong}
            onStateChange={onStateChange}
            overlay={({onCloseWithAnimation, onCloseWithoutAnimation}) => (
                <Menu
                    actions={actions}
                    placement={placement}
                    size={size}
                    maxHeight={maxHeight}
                    onCloseWithAnimation={onCloseWithAnimation}
                    onCloseWithoutAnimation={onCloseWithoutAnimation}
                    shouldNotCloseAfterActionPress={shouldNotCloseAfterActionPress}
                    extraBottom={extraOverlayBottom}
                />
            )}
        >
            {children}
        </OverlayTriggerButton>
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
export const Menu = forwardRef(function Menu(
    {
        size = "base",
        actions: nestedActions,
        placement,
        maxHeight,
        onCloseWithAnimation,
        onCloseWithoutAnimation,
        shouldNotCloseAfterActionPress,
        extraBottom,
    }: {
        size?: MenuSize;
        actions: MenuActions | (() => MenuActions);
        placement?: OverlayPlacement;
        maxHeight?: MenuMaxHeight;
        onCloseWithAnimation: () => void;
        onCloseWithoutAnimation: () => void;
        shouldNotCloseAfterActionPress?: boolean;
        extraBottom?: ReactNode;
    },
    ref: Ref<HTMLDivElement>,
) {
    const isMobile = useIsMobile();

    const {width} = menuSizeConstants[size][isMobile ? "mobile" : "desktop"];

    const flattenedActions = useMemo(() => {
        const flattenedActions: Array<{type: "Action"; action: MenuAction} | {type: "Divider"}> =
            [];

        for (const nestedAction of typeof nestedActions === "function"
            ? nestedActions()
            : nestedActions) {
            if (!isReadonlyArray(nestedAction)) {
                flattenedActions.push({type: "Action", action: nestedAction});
                continue;
            }

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

    const menuRef = useRef<HTMLDivElement>(null);
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

    function getFocusedActionIndexIfExists() {
        if (!document.activeElement) return null;
        const index = menuItemRefs.findIndex(
            menuItemRef => menuItemRef?.current === document.activeElement,
        );
        return index === -1 ? null : index;
    }

    function setAriaActiveDescendant(event: React.FocusEvent<HTMLDivElement>) {
        const menuElement = event.currentTarget;

        const activeIndex = getFocusedActionIndexIfExists();
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

    const hasInitiallyRenderedRef = useRef(false);

    // If our menu is large enough to scroll, automatically scroll to the first
    // `isSelected` item on initial mount.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyRenderedRef.current) return;
        hasInitiallyRenderedRef.current = true;

        const menuElement = assertExists(menuRef.current);

        // Menu not long enough to scroll.
        if (menuElement.scrollHeight <= menuElement.clientHeight) return;

        for (let index = 0; index < flattenedActions.length; index++) {
            const action = flattenedActions[index]!;

            if (
                action.type === "Action" &&
                !action.action.withCustomLayout &&
                action.action.isSelected
            ) {
                assertExists(menuItemRefs[index]?.current).scrollIntoView({
                    behavior: "instant",
                    block: "center",
                });
            }
        }
    }, [flattenedActions, menuItemRefs]);

    return (
        <div
            ref={useMergedRefs(ref, menuRef, useScrollbar())}
            role="menu"
            // The menu container has `tabindex` set to -1 or 0 and
            // `aria-activedescendant` set to the ID of the focused item.
            //
            // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
            tabIndex={-1}
            className={classNames(
                greyElevated2ClassName,
                sprinkles({
                    position: "relative",
                    minWidth: width,
                    maxHeight: maxHeight,
                    overflowX: "hidden",
                    overflowY: "auto",
                    borderRadius: "md",
                    padding: "1",
                    backgroundColor: "grey-0",
                    // On mobile, increase the distance of a menu from the underlying content.
                    // Increased contrast is useful.
                    boxShadow: isMobile ? "elevation-30" : "elevation-20",
                }),
            )}
            onFocus={setAriaActiveDescendant}
            onBlur={setAriaActiveDescendant}
            onKeyDown={event => {
                switch (event.key) {
                    // When focus is in a menu, moves focus to the next item, optionally
                    // wrapping from the last to the first.
                    //
                    // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                    case "ArrowDown": {
                        event.preventDefault(); // Don’t scroll
                        event.stopPropagation();

                        setInteractionModality("keyboard");

                        const currentIndex = getFocusedActionIndexIfExists();
                        if (currentIndex !== null) {
                            for (
                                let index = currentIndex + 1;
                                index < menuItemRefs.length;
                                index++
                            ) {
                                const menuItemRef = menuItemRefs[index]!;
                                if (menuItemRef) {
                                    menuItemRef.current?.focus();
                                    return;
                                }
                            }
                        }

                        // If we did not find a menu item after `currentIndex` then loop back around to
                        // the first menu item.
                        for (let index = 0; index < menuItemRefs.length; index++) {
                            const menuItemRef = menuItemRefs[index]!;
                            if (menuItemRef) {
                                menuItemRef.current?.focus();
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

                        setInteractionModality("keyboard");

                        const currentIndex = getFocusedActionIndexIfExists();
                        if (currentIndex !== null) {
                            for (let index = currentIndex - 1; index >= 0; index--) {
                                const menuItemRef = menuItemRefs[index]!;
                                if (menuItemRef) {
                                    menuItemRef.current?.focus();
                                    return;
                                }
                            }
                        }

                        // If we did not find a menu item before `currentIndex` then loop back around to
                        // the first menu item.
                        for (let index = menuItemRefs.length - 1; index >= 0; index--) {
                            const menuItemRef = menuItemRefs[index]!;
                            if (menuItemRef) {
                                menuItemRef.current?.focus();
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

                        for (let index = 0; index < menuItemRefs.length; index++) {
                            const menuItemRef = menuItemRefs[index]!;
                            if (menuItemRef) {
                                menuItemRef.current?.focus();
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

                        for (let index = menuItemRefs.length - 1; index >= 0; index--) {
                            const menuItemRef = menuItemRefs[index]!;
                            if (menuItemRef) {
                                menuItemRef.current?.focus();
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
                                    action.action.label
                                        .slice(0, nextSearchText.length)
                                        .toLowerCase() === nextSearchText.toLowerCase(),
                            );
                            if (nextIndex !== -1) menuItemRefs[nextIndex]?.current?.focus();
                            setSearchText(nextSearchText);
                            return;
                        }
                    }
                }
            }}
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
                                size={size}
                                action={action.action}
                                parentPlacement={placement}
                                onCloseWithAnimation={onCloseWithAnimation}
                                onCloseWithoutAnimation={onCloseWithoutAnimation}
                                shouldNotCloseAfterPress={shouldNotCloseAfterActionPress}
                            />
                        );
                    }
                    default:
                        throw exhaustive(action);
                }
            })}
            {extraBottom}
        </div>
    );
});

const defaultMouseMenuItemPressErrorTitle = "The menu option you clicked didn’t work";
const defaultTouchMenuItemPressErrorTitle = "The menu option you tapped didn’t work";

export const MenuItem = forwardRef(function MenuItem(
    {
        size = "base",
        action,
        parentPlacement,
        onCloseWithAnimation,
        onCloseWithoutAnimation,
        isNotFocusable = false,
        isFocusRingVisible = false,
        shouldNotCloseAfterPress = false,
    }: {
        size?: MenuSize;
        action: MenuAction;
        parentPlacement?: OverlayPlacement;
        onCloseWithAnimation: () => void;
        onCloseWithoutAnimation: () => void;
        isNotFocusable?: boolean;
        isFocusRingVisible?: boolean;
        shouldNotCloseAfterPress?: boolean;
    },
    ref: Ref<HTMLDivElement>,
) {
    const id = useId();

    if (action.withCustomLayout) {
        return (
            <MenuCustomItem
                menuItemRef={ref}
                menuItemId={id}
                action={action}
                onCloseWithAnimation={onCloseWithAnimation}
                onCloseWithoutAnimation={onCloseWithoutAnimation}
                isNotFocusable={isNotFocusable}
                isFocusRingVisible={isFocusRingVisible}
                shouldNotCloseAfterPress={shouldNotCloseAfterPress}
            />
        );
    }

    if (action.disabledReason !== undefined) {
        return (
            <Tooltip
                placement={
                    parentPlacement &&
                    (parentPlacement.startsWith("left") ||
                        parentPlacement === "top-end" ||
                        parentPlacement === "bottom-end")
                        ? "left"
                        : "right"
                }
                content={action.disabledReason}
                offset="3"
                // If the user presses a disabled button, keep showing the tooltip.
                isVisibleAfterPress={true}
            >
                {({skipHoverDelay}) => (
                    <MenuStandardItem
                        ref={ref}
                        size={size}
                        menuItemId={id}
                        action={action}
                        onCloseWithAnimation={onCloseWithAnimation}
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                        skipTooltipHoverDelay={skipHoverDelay}
                        isNotFocusable={isNotFocusable}
                        isFocusRingVisible={isFocusRingVisible}
                        shouldNotCloseAfterPress={shouldNotCloseAfterPress}
                    />
                )}
            </Tooltip>
        );
    } else {
        return (
            <MenuStandardItem
                ref={ref}
                size={size}
                menuItemId={id}
                action={action}
                onCloseWithAnimation={onCloseWithAnimation}
                onCloseWithoutAnimation={onCloseWithoutAnimation}
                isNotFocusable={isNotFocusable}
                isFocusRingVisible={isFocusRingVisible}
                shouldNotCloseAfterPress={shouldNotCloseAfterPress}
            />
        );
    }
});

const MenuStandardItem = forwardRef(function MenuStandardItem(
    {
        size,
        menuItemId,
        action,
        onCloseWithAnimation,
        onCloseWithoutAnimation,
        skipTooltipHoverDelay,
        isNotFocusable,
        isFocusRingVisible,
        shouldNotCloseAfterPress,
    }: {
        size: MenuSize;
        menuItemId: string;
        action: MenuStandardAction;
        onCloseWithAnimation: () => void;
        onCloseWithoutAnimation: () => void;
        skipTooltipHoverDelay?: () => void;
        isNotFocusable: boolean;
        isFocusRingVisible: boolean;
        shouldNotCloseAfterPress: boolean;
    },
    ref: Ref<HTMLDivElement>,
) {
    const isMobile = useIsMobile();
    const showToast = useShowToast();

    const {width, iconSize, itemPaddingY} =
        menuSizeConstants[size][isMobile ? "mobile" : "desktop"];

    const [pendingState, setPendingState] = useState<
        | {isPending: false; shouldShowPendingSpinner: false}
        | {isPending: true; shouldShowPendingSpinner: boolean}
    >({isPending: false, shouldShowPendingSpinner: false});
    const isVisuallyDisabled = action.isDisabled || action.disabledReason !== undefined;
    const isDisabled = isVisuallyDisabled || pendingState.isPending;

    const {isHovered, hoverProps} = useHover({
        isDisabled: isVisuallyDisabled,
        // When the mouse hovers over a menu item, we focus it so if the user
        // then uses the keyboard (presses enter or an arrow key) we navigate
        // using the hovered menu item.
        onHoverStart: event => event.target.focus({preventScroll: true}),
        onHoverEnd: event => event.target.blur(),
    });

    const {isPressed, pressProps} = usePress({
        // We want visually disabled buttons to be pressable so they can show their
        // tooltip with the reason for why they are disabled.
        isDisabled: isDisabled && !isVisuallyDisabled,
        onPress: event => {
            if (isVisuallyDisabled) {
                skipTooltipHoverDelay?.();
                return;
            }

            if (isDisabled) return;

            const {pressErrorTitle} = action;

            let promise;
            try {
                promise = action.onPress();
            } catch (error) {
                showToast({
                    type: "Error",
                    title:
                        pressErrorTitle ??
                        (event.pointerType === "touch"
                            ? defaultTouchMenuItemPressErrorTitle
                            : defaultMouseMenuItemPressErrorTitle),
                    error,
                });
                return;
            }

            // If the press returns a promise:
            //
            // - Only close the menu if the action succeeds
            // - Show a loading spinner after a short delay
            // - Show a toast if there was an error
            if (!(promise instanceof Promise)) {
                if (!shouldNotCloseAfterPress) {
                    onCloseWithoutAnimation();
                }
            } else {
                const promiseStartTime = new Date();

                setPendingState({isPending: true, shouldShowPendingSpinner: false});

                assert(
                    pressErrorTitle,
                    "If `onPress` returns a promise then the `pressErrorTitle` prop is required",
                );

                promise.then(
                    () => {
                        if (!shouldNotCloseAfterPress) {
                            // Our animation principle is to respond to user input immediately
                            // without animation.
                            //
                            // If the item had to go into a loading state we consider the click long
                            // enough ago that it is no longer a direct action.
                            if (
                                new Date().getTime() - promiseStartTime.getTime() >
                                delayLoadingIndicatorLimitMs
                            ) {
                                onCloseWithAnimation();
                            } else {
                                onCloseWithoutAnimation();
                            }
                        }
                    },
                    error => {
                        setPendingState({isPending: false, shouldShowPendingSpinner: false});
                        showToast({
                            type: "Error",
                            title: pressErrorTitle,
                            error,
                        });
                    },
                );
            }
        },
    });

    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    useEffect(() => {
        if (!pendingState.isPending || pendingState.shouldShowPendingSpinner) return;

        const timeout = createTimeout(() => {
            setPendingState({isPending: true, shouldShowPendingSpinner: true});
        }, delayLoadingIndicatorLimitMs);

        return () => {
            timeout.clear();
        };
    }, [pendingState]);

    const icon = action.icon && (
        <Box flexShrink="0" width={iconSize} height={iconSize}>
            <IconContext.Provider
                value={{
                    color: isVisuallyDisabled
                        ? colorSchemeVars["grey-40"]
                        : isPressed
                        ? colorSchemeVars["grey-text"]
                        : colorSchemeVars["grey-70"],
                    size: spacing[iconSize],
                    weight: "regular",
                }}
            >
                {typeof action.icon === "function"
                    ? action.icon({size: iconSize, isDisabled})
                    : action.icon}
            </IconContext.Provider>
        </Box>
    );

    return (
        <FocusRing isVisible={isFocusRingVisible} offset="0">
            <Box
                {...mergeProps(hoverProps, pressProps)}
                ref={ref}
                id={menuItemId}
                {...(!isNotFocusable
                    ? {
                          role: "menuitem",
                          // Each item in the menu has `tabindex` set to -1. (Even disabled items
                          // are focusable.)
                          //
                          // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                          tabIndex: -1,
                      }
                    : {})}
                minWidth={width}
                paddingX="2"
                paddingY={itemPaddingY}
                borderRadius="base"
                // NOTE(calebmer): We don't have a red destructive menu item style because it
                // seems silly to call attention to the destructive action with color.
                color={isVisuallyDisabled ? "grey-40" : "grey-text"}
                backgroundColor={
                    isPressed && !isVisuallyDisabled ? "grey-10" : isHovered ? "grey-5" : undefined
                }
                // When a menu item is disabled, `aria-disabled` is set to true.
                //
                // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                aria-disabled={isDisabled ? true : undefined}
                display="flex"
                alignItems="center"
                gap="2"
            >
                {(!action.iconPlacement || action.iconPlacement === "start") && icon}
                <Box flexGrow="1" fontStyle="truncate">
                    {action.label}
                </Box>
                {pendingState.shouldShowPendingSpinner && (
                    <Box flexShrink="0">
                        <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                    </Box>
                )}
                {!isMobile && action.keyboardShortcutHint && (
                    <Box flexShrink="0">
                        <Box color={isVisuallyDisabled ? "grey-30" : "grey-50"} fontSize="50">
                            <IconContext.Provider
                                value={{
                                    color: "currentColor",
                                    size: spacing["3"],
                                }}
                            >
                                {action.keyboardShortcutHint}
                            </IconContext.Provider>
                        </Box>
                    </Box>
                )}
                {action.isSelected && (
                    <Box flexShrink="0">
                        <Check
                            size={spacing["3"]}
                            color={
                                isPressed
                                    ? colorSchemeVars["grey-text"]
                                    : colorSchemeVars["grey-70"]
                            }
                        />
                    </Box>
                )}
                {action.iconPlacement === "end" && icon}
            </Box>
        </FocusRing>
    );
});

function MenuCustomItem({
    menuItemRef,
    menuItemId,
    action,
    onCloseWithAnimation,
    onCloseWithoutAnimation,
    isNotFocusable,
    isFocusRingVisible,
    shouldNotCloseAfterPress,
}: {
    menuItemRef: Ref<HTMLDivElement>;
    menuItemId: string;
    action: MenuCustomAction;
    onCloseWithAnimation: () => void;
    onCloseWithoutAnimation: () => void;
    isNotFocusable: boolean;
    isFocusRingVisible: boolean;
    shouldNotCloseAfterPress: boolean;
}) {
    const showToast = useShowToast();
    const [pendingState, setPendingState] = useState<
        | {isPending: false; shouldShowPendingSpinner: false}
        | {isPending: true; shouldShowPendingSpinner: boolean}
    >({isPending: false, shouldShowPendingSpinner: false});

    const {isPressed, pressProps} = usePress({
        isDisabled: pendingState.isPending,
        onPress: event => {
            const {pressErrorTitle} = action;

            let promise;
            try {
                promise = action.onPress();
            } catch (error) {
                showToast({
                    type: "Error",
                    title:
                        pressErrorTitle ??
                        (event.pointerType === "touch"
                            ? defaultTouchMenuItemPressErrorTitle
                            : defaultMouseMenuItemPressErrorTitle),
                    error,
                });
                return;
            }

            // If the press returns a promise:
            //
            // - Only close the menu if the action succeeds
            // - Show a loading spinner after a short delay
            // - Show a toast if there was an error
            if (!(promise instanceof Promise)) {
                if (!shouldNotCloseAfterPress) {
                    onCloseWithoutAnimation();
                }
            } else {
                const promiseStartTime = new Date();

                setPendingState({isPending: true, shouldShowPendingSpinner: false});

                assert(
                    pressErrorTitle,
                    "If `onPress` returns a promise then the `pressErrorTitle` prop is required",
                );

                promise.then(
                    () => {
                        if (!shouldNotCloseAfterPress) {
                            // Our animation principle is to respond to user input immediately
                            // without animation.
                            //
                            // If the item had to go into a loading state we consider the click long
                            // enough ago that it is no longer a direct action.
                            if (
                                new Date().getTime() - promiseStartTime.getTime() >
                                delayLoadingIndicatorLimitMs
                            ) {
                                onCloseWithAnimation();
                            } else {
                                onCloseWithoutAnimation();
                            }
                        }
                    },
                    error => {
                        setPendingState({isPending: false, shouldShowPendingSpinner: false});
                        showToast({
                            type: "Error",
                            title: pressErrorTitle,
                            error,
                        });
                    },
                );
            }
        },
    });

    const {isHovered, hoverProps} = useHover({
        // When the mouse hovers over a menu item, we focus it so if the user
        // then uses the keyboard (presses enter or an arrow key) we navigate
        // using the hovered menu item.
        onHoverStart: event => event.target.focus(),
        onHoverEnd: event => event.target.blur(),
    });

    // We wait a bit before showing our pending spinner. Some actions are very fast so we
    // delay showing a spinner to avoid a loading spinner flicker which can be jarring.
    useEffect(() => {
        if (!pendingState.isPending || pendingState.shouldShowPendingSpinner) return;

        const timeout = createTimeout(() => {
            setPendingState({isPending: true, shouldShowPendingSpinner: true});
        }, delayLoadingIndicatorLimitMs);

        return () => {
            timeout.clear();
        };
    }, [pendingState]);

    return (
        <FocusRing isVisible={isFocusRingVisible} offset="0">
            <Box
                {...mergeProps(hoverProps, pressProps)}
                ref={menuItemRef}
                id={menuItemId}
                {...(!isNotFocusable
                    ? {
                          role: "menuitem",
                          // Each item in the menu has `tabindex` set to -1. (Even disabled items
                          // are focusable.)
                          //
                          // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                          tabIndex: -1,
                      }
                    : {})}
                borderRadius="base"
                backgroundColor={isPressed ? "grey-10" : isHovered ? "grey-5" : undefined}
                // When a menu item is disabled, `aria-disabled` is set to true.
                //
                // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                aria-disabled={pendingState.isPending ? true : undefined}
            >
                {action.render({
                    isPressed,
                    isHovered,
                    shouldShowPendingSpinner: pendingState.shouldShowPendingSpinner,
                })}
            </Box>
        </FocusRing>
    );
}
