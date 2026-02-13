import {PressEvent, setInteractionModality} from "@react-aria/interactions";
import classNames from "classnames";
import {CaretRight, Check, IconContext, SpinnerGap} from "phosphor-react";
import React, {
    Key,
    ReactElement,
    ReactNode,
    Ref,
    RefObject,
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
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {getNextFocusableElementIfExists} from "~/client/web/design/helpers/get_next_focusable_element.js";
import {OverlayPlacement} from "~/client/web/design/overlay.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {
    subscribeToTriggeredOverlayCloseEvent,
    subscribeToTriggeredOverlayOpenEvent,
} from "~/client/web/design/overlay_trigger_button_event_listeners.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {isElementOwnedBy} from "~/client/web/helpers/elements/is_element_owned_by.js";
import {isModifiedKeyboardEvent} from "~/client/web/helpers/events/is_modified_keyboard_event.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {assignRef} from "~/client/web/helpers/refs/assign_ref.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {usePromise} from "~/client/web/helpers/use_promise.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {colorSchemeVars, spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";

/**
 * A list of actions or action sections. In between each section is a divider
 * and optionally a header.
 */
export type MenuActions = ReadonlyArray<MenuAction | MenuActionsSection>;

/**
 * A ref to a menu item element that exposes a `press()` method for
 * programmatically triggering the press action.
 */
export type MenuItemRef = HTMLDivElement & {
    press(): void;
};

/**
 * An section of actions in a menu which might or might not have a header.
 */
export type MenuActionsSection =
    | ReadonlyArray<MenuAction>
    | {readonly heading: string; readonly actions: ReadonlyArray<MenuAction>};

/**
 * A single action in a menu.
 */
export type MenuAction = MenuStandardAction | MenuCustomAction | MenuChildrenAction;

export type MenuStandardAction = {
    /**
     * Unique key for the action. Optional, by default we'll use the action index
     * as the key.
     */
    readonly key?: Key;

    /**
     * What label do we present to the user for this action?
     *
     * Every action must have a unique label because we also use this string,
     * internally, as the key for our actions.
     */
    readonly label: string;

    /**
     * Font size of the label. Defaults to `75`.
     */
    readonly labelFontSize?: "75" | "100";

    /**
     * Font style of the label. Defaults to `normal`.
     */
    readonly labelFontStyle?: "normal" | "semi-bold";

    /**
     * An optional icon element rendered next to the action label.
     */
    readonly icon?:
        | ReactNode
        | ((props: {size: "4"; isPressed: boolean; isDisabled: boolean}) => ReactNode);

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
     * A single character keyboard shortcut that triggers this action when the
     * menu is open. When the user presses this key, the action's `onPress`
     * handler will be called immediately.
     *
     * Must be unique within the menu - duplicate shortcuts will throw an error.
     */
    readonly keyboardShortcut?: string;

    /**
     * When the user chooses this action through either the keyboard or mouse we
     * will call this handler.
     *
     * If a promise is returned we will show a loading spinner while waiting for
     * the promise to resolve. If you return a promise you must pass in a
     * `pressErrorTitle` property to communicate to the user what failed after
     * the press.
     */
    readonly onPress: () => MaybePromise<{withoutClose: boolean} | void>;

    /**
     * If an error occurs while running `onPress` we will report the error to the user with
     * this title. It is the "what happened" part of an error message according to [Adobe
     * Spectrum's][1] error content guidelines.
     *
     * So for example it this is a delete comment action say "Couldn't delete comment".
     *
     * Required when the `onPress` event returns a promise.
     *
     * [1]: https://spectrum.adobe.com/page/writing-for-errors
     */
    readonly pressErrorTitle?: string;

    /**
     * Render some UI outside of the menu item to the right of it. Clicking on this
     * bit of UI won't select the menu item. It has its own rules. You also won't
     * be able to keyboard navigate to this bit of UI since arrow up/down will
     * still navigate menu items as normal.
     */
    readonly extraActions?: ReactNode;

    readonly withCustomLayout?: undefined;
    readonly hasChildren?: undefined;
    readonly heading?: undefined;
};

export type MenuCustomAction = {
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
    readonly hasChildren?: undefined;
    readonly heading?: undefined;

    /**
     * A single character keyboard shortcut that triggers this action when the
     * menu is open. When the user presses this key, the action's `onPress`
     * handler will be called immediately.
     *
     * Must be unique within the menu - duplicate shortcuts will throw an error.
     */
    readonly keyboardShortcut?: string;

    /**
     * Called when this action is activated either by mouse or by keyboard.
     *
     * If a promise is returned we will show a loading spinner while waiting for
     * the promise to resolve. If you return a promise you must pass in a
     * `pressErrorTitle` property to communicate to the user what failed after
     * the press.
     */
    readonly onPress: () => MaybePromise<{withoutClose: boolean} | void>;

    /**
     * If an error occurs while running `onPress` we will report the error to the user with
     * this title. It is the "what happened" part of an error message according to [Adobe
     * Spectrum's][1] error content guidelines.
     *
     * So for example it this is a delete comment action say "Couldn't delete comment".
     *
     * Required when the `onPress` event returns a promise.
     *
     * [1]: https://spectrum.adobe.com/page/writing-for-errors
     */
    readonly pressErrorTitle?: string;
} & (
    | {
          /**
           * Custom renderer for your menu action.
           */
          readonly render: (props: {
              isPressed: boolean;
              isHovered: boolean;
              shouldShowPendingSpinner: boolean;
          }) => ReactNode;

          readonly renderWithStructure?: undefined;
      }
    | {
          /**
           * Custom renderer for your menu action.
           *
           * You're responsible for rendering the menu item's structure! Which is a
           * `<Box>` element that includes event handlers (e.g. keyboard event handlers)
           * needed for the menu to operate correctly.
           *
           * You must call `renderStructure` and return the result. Otherwise, all sorts
           * of assumptions the menu component makes may break.
           *
           * This is useful if you need to wrap the structure element in an
           * `<OverlayTriggerButton>` or similar. Otherwise prefer the simpler `render`.
           */
          readonly renderWithStructure: (props: {
              isPressed: boolean;
              isHovered: boolean;
              shouldShowPendingSpinner: boolean;
              renderStructure: (props: {isPressed?: boolean; children: ReactNode}) => ReactElement;
              onCloseMenuWithAnimation: () => void;
          }) => ReactElement;

          readonly render?: undefined;
      }
);

export type MenuChildrenAction = {
    /**
     * Is this a submenu? Submenus allow you to put more menu actions behind a
     * dropdown. When the user hovers over the item they'll see more actions to the
     * right.
     *
     * We recommend against menus like this on mobile since the complexity becomes
     * hard for the user to manage.
     */
    readonly hasChildren: true;
    readonly withCustomLayout?: undefined;
    readonly heading?: undefined;

    /**
     * We need a unique key for menu items with children so we can make sure the
     * menu stays open across re-renders that change the action object.
     */
    readonly key: Key;

    /**
     * Is the child overlay placed to the right or left? Defaults to right.
     *
     * Generally it makes more sense to place child menus on the right so it
     * doesn't conflict with the left aligned menu label text. But sometimes your
     * layout will required putting them on the left.
     */
    readonly placement?: "right" | "left";

    /**
     * What label do we present to the user for this action?
     *
     * Every action must have a unique label because we also use this string,
     * internally, as the key for our actions.
     */
    readonly label: string;

    /**
     * Override the size of the sub-menu. By default we inherit the size of the
     * parent menu.
     */
    readonly size?: MenuSize;

    /**
     * An optional icon element rendered next to the action label.
     */
    readonly icon?: ReactNode | ((props: {size: "3" | "4"; isDisabled: boolean}) => ReactNode);

    /**
     * The child actions of this menu which will be displayed in a submenu.
     *
     * If you provide a function, you may load the actions asynchronously. The
     * actions will be loaded once when you open the submenu and cached while the
     * menu is open.
     */
    readonly actions: MenuActions | (() => MaybePromise<MenuActions>);

    /**
     * Called when the child menu opens and closes.
     */
    readonly onOpenChange?: (isOpen: boolean) => void;

    /**
     * Whenever an item within this menu is focused then `isFocusWithin` will be
     * set to true.
     *
     * If you provide a handler for this event, you should also consider watching
     * when the menu closes and setting this to `false`. Since the blur isn't
     * called on an unmounted element.
     */
    readonly onFocusWithinChange?: (isFocusWithin: boolean) => void;
};

export type MenuSize = "base" | "lg";
export type MenuMaxHeight = "48" | "64" | "96";

const menuSizeConstants: {
    [Key in MenuSize]: {
        [Key in "desktop" | "mobile"]: {
            width: Spacing;
        };
    };
} = {
    base: {
        desktop: {width: "48"},
        mobile: {width: "64"},
    },
    lg: {
        desktop: {width: "64"},
        mobile: {width: "64"},
    },
};

/**
 * A menu offers a list of actions to a user. A menu is rendered as an overlay
 * on top of the application.
 *
 * Implements the [WAI-ARIA menu pattern][1].
 *
 * [1]: https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
 */
const Menu = forwardRef(function Menu(
    {
        size = "base",
        actions: nestedActions,
        placement,
        maxHeight,
        onCloseWithAnimation,
        onCloseWithoutAnimation,
        isNotFocusable,
        shouldNotCloseAfterActionPress,
        extraTop,
        extraBottom,
        onFocusWithinChange,
        onArrowLeftKeyDown,
        onArrowRightKeyDown,
    }: {
        /**
         * The size of our menu. Defaults to `base`.
         *
         * On mobile, `base` menus get larger to accommodate less precise input
         * mechanisms (fingers). Items grow to `lg` size even if the menu width as a
         * whole doesn't.
         */
        size?: MenuSize;

        /**
         * All the actions available in a menu's popup. When clicking on the button
         * element to open
         *
         * If you have nested arrays then each sub-array will form a section with a
         * divider between sections.
         */
        actions: MaybeThunk<MenuActions>;

        /**
         * Where should the menu overlay be placed relative to the target element?
         * Defaults to `bottom-start`.
         */
        placement?: OverlayPlacement;

        /**
         * The maximum height of the menu. If none is provided the menu will grow
         * indefinitely.
         */
        maxHeight?: MenuMaxHeight;

        /**
         * Close the menu with an animation.
         */
        onCloseWithAnimation: () => void;

        /**
         * Close the menu without animating.
         */
        onCloseWithoutAnimation: () => void;

        /**
         * Are we not allowed to focus items in the menu? Defaults to `false`.
         */
        isNotFocusable?: boolean;

        /**
         * Should the menu close after an action is pressed? By default the menu closes
         * after an action is pressed but you may set this to true to stop that
         * behavior.
         */
        shouldNotCloseAfterActionPress?: boolean;

        /**
         * Some extra DOM to put at the top of the menu overlay. Useful if you
         * need some particularly custom in your menu.
         */
        extraTop?: ReactNode;

        /**
         * Some extra DOM to put at the bottom of the menu overlay. Useful if you
         * need some particularly custom in your menu.
         */
        extraBottom?: ReactNode;

        /**
         * Whenever an item within this menu is focused then `isFocusWithin` will be
         * set to true.
         *
         * If you provide a handler for this event, you should also consider watching
         * when the menu closes and setting this to `false`. Since the blur isn't
         * called on an unmounted element.
         */
        onFocusWithinChange?: (isFocusWithin: boolean) => void;

        /**
         * Handle left arrow key presses in the menu.
         */
        onArrowLeftKeyDown?: (event: React.KeyboardEvent) => void;

        /**
         * Handle right arrow key presses in the menu.
         */
        onArrowRightKeyDown?: (event: React.KeyboardEvent) => void;
    },
    ref: Ref<HTMLDivElement>,
) {
    const platform = usePlatform();

    const {width} = menuSizeConstants[size][platform];

    const [openedActionKey, setOpenedActionKey] = useState<Key | null>(null);

    const {flattenedActions, hasSiblingSelectedAction} = useMemo(() => {
        let keys: Set<Key> | undefined;
        let hasSiblingSelectedAction = false;

        const flattenedActions: Array<
            | {type: "Action"; action: MenuAction}
            | {type: "Divider"}
            | {type: "Heading"; heading: string}
        > = [];

        for (const nestedAction of typeof nestedActions === "function"
            ? nestedActions()
            : nestedActions) {
            if (!isReadonlyArray(nestedAction) && nestedAction.heading === undefined) {
                // Make sure all children actions have a unique `key`.
                if (nestedAction.hasChildren) {
                    assert(!keys?.has(nestedAction.key));
                    (keys ??= new Set()).add(nestedAction.key);
                }

                if (
                    !nestedAction.withCustomLayout &&
                    !nestedAction.hasChildren &&
                    nestedAction.isSelected
                ) {
                    hasSiblingSelectedAction = true;
                }

                flattenedActions.push({type: "Action", action: nestedAction});
                continue;
            }

            if (flattenedActions.length > 0) {
                flattenedActions.push({type: "Divider"});
            }

            if (!isReadonlyArray(nestedAction)) {
                flattenedActions.push({type: "Heading", heading: nestedAction.heading});
            }

            for (const action of isReadonlyArray(nestedAction)
                ? nestedAction
                : nestedAction.actions) {
                // Make sure all children actions have a unique `key`.
                if (action.hasChildren) {
                    assert(!keys?.has(action.key));
                    (keys ??= new Set()).add(action.key);
                }

                if (!action.withCustomLayout && !action.hasChildren && action.isSelected) {
                    hasSiblingSelectedAction = true;
                }

                flattenedActions.push({type: "Action", action});
            }
        }

        return {flattenedActions, hasSiblingSelectedAction};
    }, [nestedActions]);

    assert(flattenedActions.length > 0);

    const menuRef = useRef<HTMLDivElement>(null);
    const {menuItemRefs, keyboardShortcutMap} = useMemo(() => {
        // Map from lowercase shortcut key to the MenuItemRef in flattenedActions
        const keyboardShortcutMap = new Map<string, RefObject<MenuItemRef | null>>();

        function registerKeyboardShortcut(action: MenuAction, ref: RefObject<MenuItemRef | null>) {
            if (action.hasChildren) return;
            const shortcut = action.keyboardShortcut;
            if (shortcut === undefined) return;

            const normalizedShortcut = shortcut.toLowerCase();
            assert(
                !keyboardShortcutMap.has(normalizedShortcut),
                `Duplicate keyboard shortcut \u201C${shortcut}\u201D in menu`,
            );
            keyboardShortcutMap.set(normalizedShortcut, ref);
        }

        const refs = flattenedActions.map(action => {
            const ref = action.type === "Action" ? createRef<MenuItemRef>() : null;
            if (ref && action.type === "Action") registerKeyboardShortcut(action.action, ref);

            return ref;
        });
        return {menuItemRefs: refs, keyboardShortcutMap};
    }, [flattenedActions]);

    // Track which menu item is being pressed via keyboard shortcut for visual feedback.
    const [keyboardPressedMenuItemRef, setKeyboardPressedMenuItemRef] =
        useState<RefObject<MenuItemRef | null> | null>(null);

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
                ? (menuItemRefs[activeIndex]!.current?.getAttribute("id") ?? null)
                : null;

        if (activeMenuItemId !== null) {
            menuElement.setAttribute("aria-activedescendant", activeMenuItemId);
        } else {
            menuElement.removeAttribute("aria-activedescendant");
        }

        // If a direct descendant was focused then close any open submenu we may have.
        // This will happen if you open a submenu with the keyboard then hover over a
        // different menu item.
        if (event.type === "focus" && event.currentTarget.contains(event.target)) {
            const focusedAction = activeIndex !== null ? flattenedActions[activeIndex] : undefined;
            setOpenedActionKey(openedActionKey =>
                focusedAction?.type === "Action" &&
                focusedAction.action.hasChildren &&
                focusedAction.action.key === openedActionKey
                    ? openedActionKey
                    : null,
            );
        }
    }

    const hasInitiallyMountedRef = useRef(false);

    // If our menu is large enough to scroll, automatically scroll to the first
    // `isSelected` item on initial mount.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const menuElement = assertExists(menuRef.current);

        // Menu not long enough to scroll.
        if (menuElement.scrollHeight <= menuElement.clientHeight) return;

        for (let index = 0; index < flattenedActions.length; index++) {
            const action = flattenedActions[index]!;

            if (
                action.type === "Action" &&
                !action.action.withCustomLayout &&
                !action.action.hasChildren &&
                action.action.isSelected
            ) {
                assertExists(menuItemRefs[index]?.current).scrollIntoView({
                    behavior: "instant",
                    block: "center",
                });
                break;
            }
        }
    }, [flattenedActions, menuItemRefs]);

    return (
        <div
            ref={useMergedRefs(ref, menuRef, useScrollbar())}
            {...(!isNotFocusable
                ? {
                      role: "menu",
                      // The menu container has `tabindex` set to -1 or 0 and
                      // `aria-activedescendant` set to the ID of the focused item.
                      //
                      // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
                      tabIndex: -1,
                  }
                : {})}
            className={classNames(
                greyElevated2ClassName,
                sprinkles({
                    position: "relative",
                    minWidth: width,
                    maxHeight: maxHeight,
                    overflowX: "hidden",
                    overflowY: "auto",
                    borderRadius: "1.5",
                    padding: "1",
                    backgroundColor: "grey-0",
                    // On mobile, increase the distance of a menu from the underlying content.
                    // Increased contrast is useful.
                    boxShadow: platform === "mobile" ? "elevation-30" : "elevation-20",
                }),
            )}
            onFocus={event => {
                setAriaActiveDescendant(event);
                onFocusWithinChange?.(
                    event.currentTarget !== event.target &&
                        event.currentTarget.contains(event.target),
                );
            }}
            onBlur={event => {
                setAriaActiveDescendant(event);
                onFocusWithinChange?.(
                    event.currentTarget !== event.relatedTarget &&
                        event.currentTarget.contains(event.relatedTarget),
                );
            }}
            onKeyDown={event => {
                switch (event.key) {
                    // When focus is in a menu, moves focus to the next item, optionally
                    // wrapping from the last to the first.
                    //
                    // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
                    case "ArrowDown": {
                        event.preventDefault(); // Don't scroll
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
                    // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
                    case "ArrowUp": {
                        event.preventDefault(); // Don't scroll
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
                    case "ArrowLeft": {
                        // `<MenuChildrenItem>` needs to implement `ArrowLeft` to close the submenu.
                        onArrowLeftKeyDown?.(event);
                        return;
                    }
                    case "ArrowRight": {
                        // `<MenuChildrenItem>` needs to implement `ArrowRight` to close the submenu.
                        onArrowRightKeyDown?.(event);
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
                                setInteractionModality("keyboard");
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
                                setInteractionModality("keyboard");
                                menuItemRef.current?.focus();
                                return;
                            }
                        }
                        return;
                    }
                    default: {
                        // Check if the key matches a keyboard shortcut. Shortcuts take
                        // precedence over label-based search.
                        if (/^[0-9a-zA-Z]$/.test(event.key) && !isModifiedKeyboardEvent(event)) {
                            const menuItemRef = keyboardShortcutMap.get(event.key.toLowerCase());
                            if (menuItemRef !== undefined) {
                                event.preventDefault();
                                event.stopPropagation();

                                // If the user presses a shortcut key while a menu item is
                                // focused and the menu item in focus is not the one that matches
                                // the shortcut key, then blur the focused menu item.
                                // If we don't do this, we get into a weird UI state where one
                                // menu item is focused while another menu item is visually pressed.
                                const activeMenuItemIndex = getFocusedActionIndexIfExists();
                                if (activeMenuItemIndex !== null) {
                                    const activeMenuItemRef =
                                        menuItemRefs[activeMenuItemIndex]?.current;

                                    if (
                                        activeMenuItemRef &&
                                        activeMenuItemRef !== menuItemRef.current
                                    ) {
                                        activeMenuItemRef.blur();
                                    }

                                    setKeyboardPressedMenuItemRef(menuItemRef);
                                    menuItemRef.current?.press();
                                    return;
                                }
                            }
                        }

                        // Move focus to the next menu item in the current menu whose label
                        // begins with that printable character.
                        //
                        // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
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

                            setInteractionModality("keyboard");
                            if (nextIndex !== -1) menuItemRefs[nextIndex]?.current?.focus();

                            setSearchText(nextSearchText);
                            return;
                        }
                    }
                }
            }}
            onKeyUp={event => {
                // Clear the keyboard pressed state when the key is released
                if (/^[0-9a-zA-Z]$/.test(event.key) && !isModifiedKeyboardEvent(event)) {
                    const menuItemRef = keyboardShortcutMap.get(event.key.toLowerCase());
                    if (menuItemRef !== undefined && keyboardPressedMenuItemRef === menuItemRef) {
                        setKeyboardPressedMenuItemRef(null);
                    }
                }
            }}
        >
            {extraTop}
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
                                size={size}
                                action={action.action}
                                hasSiblingSelectedAction={hasSiblingSelectedAction}
                                parentPlacement={placement}
                                onCloseWithAnimation={onCloseWithAnimation}
                                onCloseWithoutAnimation={onCloseWithoutAnimation}
                                isNotFocusable={isNotFocusable}
                                shouldNotCloseAfterPress={shouldNotCloseAfterActionPress}
                                openedActionKey={openedActionKey}
                                isKeyboardPressed={
                                    keyboardPressedMenuItemRef === menuItemRefs[index]
                                }
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
    );
});

// Export as an attribute on `Menu` so we don't break hot reloading.
const MenuExport = Object.assign(Menu, {sizeConstants: menuSizeConstants});

export {MenuExport as Menu};

const defaultMouseMenuItemPressErrorTitle = "The menu option you clicked didn\u2019t work";
const defaultTouchMenuItemPressErrorTitle = "The menu option you tapped didn\u2019t work";

export const MenuItem = forwardRef(function MenuItem(
    {
        size = "base",
        action,
        hasSiblingSelectedAction = false,
        parentPlacement,
        onCloseWithAnimation,
        onCloseWithoutAnimation,
        isNotFocusable = false,
        isFocusRingVisible = false,
        shouldNotCloseAfterPress = false,
        openedActionKey,
        isKeyboardPressed = false,
        onActionOpen,
        onActionClose,
    }: {
        size?: MenuSize;
        action: MenuAction;
        hasSiblingSelectedAction?: boolean;
        parentPlacement?: OverlayPlacement;
        onCloseWithAnimation: () => void;
        onCloseWithoutAnimation: () => void;
        isNotFocusable?: boolean;
        isFocusRingVisible?: boolean;
        shouldNotCloseAfterPress?: boolean;
        openedActionKey: Key | null;
        isKeyboardPressed?: boolean;
        onActionOpen: (action: MenuChildrenAction) => void;
        onActionClose: (action: MenuChildrenAction) => void;
    },
    ref: Ref<MenuItemRef>,
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
                isKeyboardPressed={isKeyboardPressed}
            />
        );
    }

    if (action.hasChildren) {
        return (
            <MenuChildrenItem
                ref={ref}
                size={size}
                menuItemId={id}
                action={action}
                onCloseWithAnimation={onCloseWithAnimation}
                onCloseWithoutAnimation={onCloseWithoutAnimation}
                isNotFocusable={isNotFocusable}
                isFocusRingVisible={isFocusRingVisible}
                shouldNotCloseAfterPress={shouldNotCloseAfterPress}
                isOpened={openedActionKey === action.key}
                onOpen={() => onActionOpen(action)}
                onClose={() => onActionClose(action)}
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
                        hasSiblingSelectedAction={hasSiblingSelectedAction}
                        onCloseWithAnimation={onCloseWithAnimation}
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                        skipTooltipHoverDelay={skipHoverDelay}
                        isNotFocusable={isNotFocusable}
                        isFocusRingVisible={isFocusRingVisible}
                        shouldNotCloseAfterPress={shouldNotCloseAfterPress}
                        isKeyboardPressed={isKeyboardPressed}
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
                hasSiblingSelectedAction={hasSiblingSelectedAction}
                onCloseWithAnimation={onCloseWithAnimation}
                onCloseWithoutAnimation={onCloseWithoutAnimation}
                isNotFocusable={isNotFocusable}
                isFocusRingVisible={isFocusRingVisible}
                shouldNotCloseAfterPress={shouldNotCloseAfterPress}
                isKeyboardPressed={isKeyboardPressed}
            />
        );
    }
});

const MenuStandardItem = forwardRef(function MenuStandardItem(
    {
        size,
        menuItemId,
        action,
        hasSiblingSelectedAction,
        onCloseWithAnimation,
        onCloseWithoutAnimation,
        skipTooltipHoverDelay,
        isNotFocusable,
        isFocusRingVisible,
        shouldNotCloseAfterPress,
        isKeyboardPressed,
    }: {
        size: MenuSize;
        menuItemId: string;
        action: MenuStandardAction;
        hasSiblingSelectedAction: boolean;
        onCloseWithAnimation: () => void;
        onCloseWithoutAnimation: () => void;
        skipTooltipHoverDelay?: () => void;
        isNotFocusable: boolean;
        isFocusRingVisible: boolean;
        shouldNotCloseAfterPress: boolean;
        isKeyboardPressed: boolean;
    },
    foreignRef: Ref<MenuItemRef>,
) {
    const platform = usePlatform();
    const reporter = useReporter();

    const {width} = menuSizeConstants[size][platform];

    const [pendingState, setPendingState] = useState<
        | {isPending: false; shouldShowPendingSpinner: false}
        | {isPending: true; shouldShowPendingSpinner: boolean}
    >({isPending: false, shouldShowPendingSpinner: false});
    const isDisabled = action.isDisabled || action.disabledReason !== undefined;

    const {isHovered, hoverProps} = useHover({isDisabled});

    function onPress(event?: PressEvent) {
        if (action.disabledReason !== undefined) {
            skipTooltipHoverDelay?.();
            return;
        }

        if (isDisabled || pendingState.isPending) return;

        const {pressErrorTitle} = action;

        let result;
        try {
            result = action.onPress();
        } catch (error) {
            reporter.displayError(
                pressErrorTitle ??
                    (event?.pointerType === "touch"
                        ? defaultTouchMenuItemPressErrorTitle
                        : defaultMouseMenuItemPressErrorTitle),
                error,
            );
            return;
        }

        // If the press returns a promise:
        //
        // - Only close the menu if the action succeeds
        // - Show a loading spinner after a short delay
        // - Show a toast if there was an error
        if (!(result instanceof Promise)) {
            if (!result?.withoutClose && !shouldNotCloseAfterPress) {
                onCloseWithoutAnimation();
            }
        } else {
            const promiseStartTime = new Date();

            setPendingState({isPending: true, shouldShowPendingSpinner: false});

            assert(
                pressErrorTitle,
                "If `onPress` returns a promise then the `pressErrorTitle` prop is required",
            );

            result.then(
                result => {
                    if (result?.withoutClose || shouldNotCloseAfterPress) {
                        setPendingState({isPending: false, shouldShowPendingSpinner: false});
                    } else {
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
                    reporter.displayError(pressErrorTitle, error);
                },
            );
        }
    }

    const {refCallback} = useMenuItemPressRef(onPress, foreignRef);

    const {isPressed: isPressedFromHook, pressProps} = usePress({
        preventFocusOnPress: isNotFocusable,
        // We want buttons with a disabled reason to be pressable so they can show
        // their tooltip with the reason for why they are disabled.
        isDisabled: isDisabled && action.disabledReason === undefined,
        onPress,
    });

    // Combine press state from usePress hook and keyboard shortcut
    const isPressed = isPressedFromHook || isKeyboardPressed;

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
        <Box flexShrink="0" minWidth="4" minHeight="4">
            <IconContext.Provider
                value={{
                    color: isDisabled
                        ? colorSchemeVars["grey-40"]
                        : isPressed
                          ? colorSchemeVars["grey-100"]
                          : colorSchemeVars["grey-80"],
                    size: spacing["4"],
                    weight: "regular",
                }}
            >
                {typeof action.icon === "function"
                    ? action.icon({size: "4", isPressed, isDisabled})
                    : action.icon}
            </IconContext.Provider>
        </Box>
    );

    let node = (
        <FocusRing isVisible={isFocusRingVisible} offset="inset">
            <Box
                {...mergeProps(hoverProps, pressProps)}
                ref={refCallback}
                id={menuItemId}
                {...(!isNotFocusable
                    ? {
                          role: "menuitem",
                          // Each item in the menu has `tabindex` set to -1. (Even disabled items
                          // are focusable.)
                          //
                          // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
                          tabIndex: -1,
                      }
                    : {})}
                minWidth={!action.extraActions ? width : undefined}
                flexGrow={action.extraActions ? "1" : undefined}
                paddingLeft={
                    action.icon && (!action.iconPlacement || action.iconPlacement === "start")
                        ? "1.5"
                        : "2"
                }
                paddingRight={action.icon && action.iconPlacement === "end" ? "1.5" : "2"}
                paddingY="1.5"
                borderRadius="1"
                // NOTE(calebmer): We don't have a red destructive menu item style because it
                // seems silly to call attention to the destructive action with color.
                color={isDisabled ? "grey-40" : "grey-100"}
                backgroundColor={
                    isPressed && !isDisabled ? "grey-10" : isHovered ? "grey-5" : undefined
                }
                // When a menu item is disabled, `aria-disabled` is set to true.
                //
                // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
                aria-disabled={isDisabled ? true : undefined}
                display="flex"
                alignItems="center"
                gap="2"
            >
                {(!action.iconPlacement || action.iconPlacement === "start") && icon}
                <Box
                    flexGrow="1"
                    fontSize={action.labelFontSize ?? "75"}
                    fontStyle={
                        action.labelFontStyle === undefined || action.labelFontStyle === "normal"
                            ? "truncate"
                            : `truncate-${action.labelFontStyle}`
                    }
                >
                    {action.label}
                </Box>
                {pendingState.shouldShowPendingSpinner && (
                    <Box flexShrink="0">
                        <SpinnerGap
                            className={spinAnimationClassName}
                            size={spacing["4"]}
                            color={colorSchemeVars["grey-70"]}
                        />
                    </Box>
                )}
                {platform !== "mobile" && action.keyboardShortcutHint && (
                    <Box flexShrink="0">
                        <Box color={isDisabled ? "grey-30" : "grey-50"} fontSize="50">
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
                {action.isSelected ? (
                    <Box flexShrink="0" width="4" height="4" marginLeft="1">
                        <Check
                            size={spacing["4"]}
                            color={
                                isPressed ? colorSchemeVars["grey-100"] : colorSchemeVars["grey-80"]
                            }
                        />
                    </Box>
                ) : hasSiblingSelectedAction ? (
                    <Box flexShrink="0" width="4" height="4" marginLeft="1" />
                ) : null}
                {action.iconPlacement === "end" && icon}
            </Box>
        </FocusRing>
    );

    if (action.extraActions) {
        node = (
            <Box minWidth={width} display="flex" alignItems="center" gap="1">
                {node}
                {action.extraActions}
            </Box>
        );
    }

    return node;
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
    isKeyboardPressed,
}: {
    menuItemRef: Ref<MenuItemRef>;
    menuItemId: string;
    action: MenuCustomAction;
    onCloseWithAnimation: () => void;
    onCloseWithoutAnimation: () => void;
    isNotFocusable: boolean;
    isFocusRingVisible: boolean;
    shouldNotCloseAfterPress: boolean;
    isKeyboardPressed: boolean;
}) {
    const reporter = useReporter();
    const [pendingState, setPendingState] = useState<
        | {isPending: false; shouldShowPendingSpinner: false}
        | {isPending: true; shouldShowPendingSpinner: boolean}
    >({isPending: false, shouldShowPendingSpinner: false});

    function onPress(event?: PressEvent) {
        const {pressErrorTitle} = action;

        let result;
        try {
            result = action.onPress();
        } catch (error) {
            reporter.displayError(
                pressErrorTitle ??
                    (event?.pointerType === "touch"
                        ? defaultTouchMenuItemPressErrorTitle
                        : defaultMouseMenuItemPressErrorTitle),
                error,
            );
            return;
        }

        // If the press returns a promise:
        //
        // - Only close the menu if the action succeeds
        // - Show a loading spinner after a short delay
        // - Show a toast if there was an error
        if (!(result instanceof Promise)) {
            if (!result?.withoutClose && !shouldNotCloseAfterPress) {
                onCloseWithoutAnimation();
            }
        } else {
            const promiseStartTime = new Date();

            setPendingState({isPending: true, shouldShowPendingSpinner: false});

            assert(
                pressErrorTitle,
                "If `onPress` returns a promise then the `pressErrorTitle` prop is required",
            );

            result.then(
                result => {
                    if (!result?.withoutClose && !shouldNotCloseAfterPress) {
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
                    reporter.displayError(pressErrorTitle, error);
                },
            );
        }
    }

    // We need localRef for subscribing to triggered overlay events below.
    const {localRef, refCallback} = useMenuItemPressRef(onPress, menuItemRef);

    const {isPressed: isPressedFromHook, pressProps} = usePress({
        preventFocusOnPress: isNotFocusable,
        onPress,
    });

    // Combine press state from usePress hook and keyboard shortcut
    const isPressed = isPressedFromHook || isKeyboardPressed;

    const {isHovered, hoverProps} = useHover({});

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

    // If this custom menu item is using `renderWithStructure` to wrap the custom
    // menu item in an `<OverlayTriggerButton>` then we want to listen for
    // triggered overlay open/close events.
    //
    // This is used by `<MessageView>` which renders
    // `<MessageViewContextMenuReactionButton>` as a custom menu item which opens
    // an overlay.
    const [isTriggeredOverlayOpen, setIsTriggeredOverlayOpen] = useState(false);

    useEffect(() => {
        const element = assertExists(localRef.current);

        const handleOverlayOpen = () => setIsTriggeredOverlayOpen(true);
        const handleOverlayClose = () => setIsTriggeredOverlayOpen(false);

        const unsubscribe1 = subscribeToTriggeredOverlayOpenEvent(element, handleOverlayOpen);
        const unsubscribe2 = subscribeToTriggeredOverlayCloseEvent(element, handleOverlayClose);

        return () => {
            unsubscribe1();
            unsubscribe2();
        };
    }, [isNotFocusable, localRef]);

    const isHoveredBackground = isHovered || isTriggeredOverlayOpen;

    const renderStructure = ({
        isPressed: isPressedOverride,
        children,
    }: {
        isPressed?: boolean;
        children: ReactNode;
    }) => (
        <FocusRing isVisible={isFocusRingVisible} offset="inset">
            <Box
                {...mergeProps(hoverProps, pressProps)}
                // See `useMenuItemPressRef` for why we use refCallback.
                ref={refCallback}
                id={menuItemId}
                {...(!isNotFocusable
                    ? {
                          role: "menuitem",
                          // Each item in the menu has `tabindex` set to -1. (Even disabled items
                          // are focusable.)
                          //
                          // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
                          tabIndex: -1,
                      }
                    : {})}
                borderRadius="1"
                backgroundColor={
                    isPressed || isPressedOverride
                        ? "grey-10"
                        : isHoveredBackground
                          ? "grey-5"
                          : undefined
                }
                // When a menu item is disabled, `aria-disabled` is set to true.
                //
                // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
                aria-disabled={pendingState.isPending ? true : undefined}
            >
                {children}
            </Box>
        </FocusRing>
    );

    if (action.render !== undefined) {
        return renderStructure({
            children: action.render({
                isPressed,
                isHovered,
                shouldShowPendingSpinner: pendingState.shouldShowPendingSpinner,
            }),
        });
    } else {
        return action.renderWithStructure({
            isPressed,
            isHovered,
            shouldShowPendingSpinner: pendingState.shouldShowPendingSpinner,
            renderStructure,
            onCloseMenuWithAnimation: onCloseWithAnimation,
        });
    }
}

const MenuChildrenItem = forwardRef(function MenuChildrenItem(
    {
        size,
        menuItemId,
        action,
        onCloseWithAnimation,
        onCloseWithoutAnimation,
        isNotFocusable,
        isFocusRingVisible,
        shouldNotCloseAfterPress,
        isOpened: shouldOpen,
        onOpen: onOpenFromProps,
        onClose,
    }: {
        size: MenuSize;
        menuItemId: string;
        action: MenuChildrenAction;
        onCloseWithAnimation: () => void;
        onCloseWithoutAnimation: () => void;
        isNotFocusable: boolean;
        isFocusRingVisible: boolean;
        shouldNotCloseAfterPress: boolean;
        isOpened: boolean;
        onOpen: () => void;
        onClose: () => void;
    },
    ref: Ref<HTMLDivElement>,
) {
    const platform = usePlatform();

    const placement = action.placement ?? "right";

    const [actionsPromise, setActionsPromise] = useState<PromiseImmediate<MenuActions> | null>(
        () =>
            typeof action.actions !== "function" ? PromiseImmediate.resolve(action.actions) : null,
    );

    const onOpen = () => {
        if (actionsPromise === null) {
            setActionsPromise(
                PromiseImmediate.resolve(
                    typeof action.actions !== "function" ? action.actions : action.actions(),
                ),
            );
        }

        onOpenFromProps();
    };

    // Fallback in case the `shouldOpen` prop is set to true without `onOpen()`
    // having been called.
    useEffect(() => {
        if (shouldOpen && actionsPromise === null) {
            setActionsPromise(
                PromiseImmediate.resolve(
                    typeof action.actions !== "function" ? action.actions : action.actions(),
                ),
            );
        }
    }, [action, actionsPromise, shouldOpen]);

    const {value: actions} = usePromise(actionsPromise);

    const isOpened = shouldOpen && !!actions;
    const shouldShowPendingSpinner = useDelayLoadingIndicator(shouldOpen && !isOpened);

    const itemRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const overlayMenuRef = useRef<HTMLDivElement>(null);
    const hoverTriangleContainerRef = useRef<HTMLDivElement>(null);

    const {width} = menuSizeConstants[size][platform];

    const [isHovered, setIsHovered] = useState(false);

    const [shouldInitiallyFocus, setShouldInitiallyFocus] = useState(false);
    if (shouldInitiallyFocus && !isOpened && !shouldOpen) setShouldInitiallyFocus(false);

    const hasInitiallyFocusedRef = useRef(false);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!shouldInitiallyFocus) {
            hasInitiallyFocusedRef.current = false;
            return;
        }

        if (!isOpened) {
            // If `shouldOpen` is true but `isOpened` is false, then we want to focus when
            // `isOpened` becomes true. So we can't clear this ref.
            if (!shouldOpen) {
                hasInitiallyFocusedRef.current = false;
            }
            return;
        }

        const overlayMenuElement = assertExists(overlayMenuRef.current);

        if (hasInitiallyFocusedRef.current) return;
        hasInitiallyFocusedRef.current = true;

        getNextFocusableElementIfExists(null, {
            withinElement: overlayMenuElement,
        })?.focus({preventScroll: true});
    }, [isOpened, shouldInitiallyFocus, shouldOpen]);

    const [hoverTriangleState, setHoverTriangleState] = useState<{
        readonly initialX: number;
        readonly initialY: number;
    } | null>(null);
    if (!shouldOpen && hoverTriangleState) setHoverTriangleState(null);

    const {isPressed, pressProps} = usePress({
        preventFocusOnPress: isNotFocusable,
        onPress: event => {
            // For `Enter` and `Space` keyboard events: When focus is on a `menuitem` that
            // has a submenu, opens the submenu and places focus on its first item.
            //
            // For touch/pointer events: Open the submenu so mobile devices can access
            // submenus.
            //
            // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
            if (!isOpened) {
                // If we should open but haven't opened yet, that's because we're waiting on
                // asynchronous actions to load.
                if (!shouldOpen) {
                    // Only focus on keyboard interaction, not touch
                    if (event.pointerType === "keyboard") {
                        setShouldInitiallyFocus(true);
                    }
                    onOpen();
                }
            } else {
                // Only focus for keyboard interaction
                if (event.pointerType === "keyboard") {
                    const overlayMenuElement = assertExists(overlayMenuRef.current);

                    getNextFocusableElementIfExists(null, {
                        withinElement: overlayMenuElement,
                    })?.focus({preventScroll: true});
                }
            }
        },
    });

    const [isHoverTrianglePressed, setIsHoverTrianglePressed] = useState(false);
    if (isHoverTrianglePressed && (!shouldOpen || !hoverTriangleState))
        setIsHoverTrianglePressed(false);

    const onCloseEvent = useEvent(onClose);

    // If we opened the submenu because the mouse hovered over the menu item then
    // if the mouse moves over anything else we want to close the submenu.
    //
    // `hoverTriangleState` only exists if we opened the submenu when the mouse
    // hovered over it. If the submenu opened after keyboard interaction then
    // `hoverTriangleState` will not be set.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!shouldOpen || !hoverTriangleState) return;

        const element = assertExists(itemRef.current);

        const handlePointerMove = (event: PointerEvent) => {
            if (!(event.target instanceof Element)) {
                onCloseEvent();
                return;
            }

            if (!isElementOwnedBy(element, event.target)) {
                onCloseEvent();
                return;
            }

            if (element.contains(event.target)) {
                // If the user moves their cursor outside of the hover triangle but still in
                // the menu item, update the hover triangle.
                setHoverTriangleState({
                    initialX: event.clientX,
                    initialY: event.clientY,
                });
            }
        };

        document.addEventListener("pointermove", handlePointerMove);
        return () => {
            document.removeEventListener("pointermove", handlePointerMove);
        };
    }, [hoverTriangleState, onCloseEvent, shouldOpen]);

    // Submenu dropdowns, if not implemented properly, can be quite user hostile.
    // Since when the user hovers over a menu item and tries to move their cursor
    // to the last item in the submenu they may leave the hit area of the original
    // menu item which closes the submenu. This requires a user to perfectly move
    // their mouse horizontally into the submenu then down. This is slow since it
    // requires precision from the user.
    //
    // A more user friendly approach to dropdowns is to render a triangle from
    // where the user's mouse starts to the top and bottom of the submenu. If the
    // mouse moves within that area we can keep the submenu open.
    //
    // The Smashing Magazine article "[User-Friendly Mega-Dropdowns: When Hover
    // Menus Fail][1]" describes the issue visually and lists a couple solutions.
    // We implement the same triangle approach invented by Amazon detailed in
    // "[Breaking down Amazon's mega dropdown][2]."
    //
    // [1]: https://www.smashingmagazine.com/2021/05/frustrating-design-patterns-mega-dropdown-hover-menus/
    // [2]: https://bjk5.com/post/44698559168/breaking-down-amazons-mega-dropdown
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!isOpened || !hoverTriangleState) return;

        const shouldDebug: CommitBlocker | null = null;

        // Make sure `shouldDebug` isn't set outside of dev mode.
        if (shouldDebug) {
            assert(process.env.NODE_ENV === "development");
        }

        const element = assertExists(itemRef.current);
        const overlayElement = assertExists(overlayRef.current);
        const hoverTriangleContainerElement = assertExists(hoverTriangleContainerRef.current);

        const elementRect = element.getBoundingClientRect();
        const overlayElementRect = overlayElement.getBoundingClientRect();

        const overlayOffsetY = elementRect.top - overlayElementRect.top;

        const xmlns = "http://www.w3.org/2000/svg";

        const hoverTriangleElement = document.createElementNS(xmlns, "svg");
        hoverTriangleElement.setAttribute(
            "viewbox",
            `0 0 ${element.clientWidth} ${overlayElement.clientHeight}`,
        );
        hoverTriangleElement.setAttribute(
            "style",
            [
                `width: ${element.clientWidth}px`,
                `height: ${overlayElement.clientHeight}px`,
                "position: absolute",
                "top: 0",
                `${placement !== "left" ? "left" : "right"}: -${element.clientWidth}px`,
            ].join("; "),
        );

        const hoverTriangleSlopPx = 5;

        const hoverTrianglePolygonElement = document.createElementNS(xmlns, "polygon");
        hoverTrianglePolygonElement.setAttribute(
            "style",
            `pointer-events: auto; ${
                shouldDebug
                    ? `fill: ${colorSchemeVars["red-40-const"]}; opacity: 0.4`
                    : "fill: transparent"
            }`,
        );
        switch (placement) {
            case "right": {
                hoverTrianglePolygonElement.setAttribute(
                    "points",
                    [
                        `${hoverTriangleState.initialX - elementRect.left - hoverTriangleSlopPx} ${
                            hoverTriangleState.initialY -
                            elementRect.top +
                            hoverTriangleSlopPx +
                            overlayOffsetY
                        }`,
                        `${hoverTriangleState.initialX - elementRect.left - hoverTriangleSlopPx} ${
                            hoverTriangleState.initialY -
                            elementRect.top -
                            hoverTriangleSlopPx +
                            overlayOffsetY
                        }`,
                        `${element.clientWidth} 0`,
                        `${element.clientWidth} ${overlayElement.clientHeight}`,
                    ].join(", "),
                );
                break;
            }
            case "left": {
                hoverTrianglePolygonElement.setAttribute(
                    "points",
                    [
                        `${hoverTriangleState.initialX - elementRect.left + hoverTriangleSlopPx} ${
                            hoverTriangleState.initialY -
                            elementRect.top +
                            hoverTriangleSlopPx +
                            overlayOffsetY
                        }`,
                        `${hoverTriangleState.initialX - elementRect.left + hoverTriangleSlopPx} ${
                            hoverTriangleState.initialY -
                            elementRect.top -
                            hoverTriangleSlopPx +
                            overlayOffsetY
                        }`,
                        "0 0",
                        `0 ${overlayElement.clientHeight}`,
                    ].join(", "),
                );
                break;
            }
            default:
                throw exhaustive(placement);
        }

        hoverTriangleElement.addEventListener("pointerdown", event => {
            const elementRect = element.getBoundingClientRect();

            if (
                elementRect.left <= event.clientX &&
                event.clientX <= elementRect.right &&
                elementRect.top <= event.clientY &&
                event.clientY <= elementRect.bottom
            ) {
                setIsHoverTrianglePressed(true);
            } else {
                onCloseEvent();
            }
        });

        hoverTriangleElement.addEventListener("pointerup", () => {
            setIsHoverTrianglePressed(false);
        });

        hoverTriangleElement.addEventListener("pointerleave", () => {
            setIsHoverTrianglePressed(false);
        });

        hoverTriangleElement.addEventListener("pointercancel", () => {
            setIsHoverTrianglePressed(false);
        });

        hoverTriangleElement.appendChild(hoverTrianglePolygonElement);
        hoverTriangleContainerElement.appendChild(hoverTriangleElement);

        return () => {
            hoverTriangleElement.remove();
        };
    }, [hoverTriangleState, isOpened, onCloseEvent, placement]);

    const icon = action.icon && (
        <Box flexShrink="0" minWidth="4" minHeight="4">
            <IconContext.Provider
                value={{
                    color: isPressed ? colorSchemeVars["grey-100"] : colorSchemeVars["grey-80"],
                    size: spacing["4"],
                    weight: "regular",
                }}
            >
                {typeof action.icon === "function"
                    ? action.icon({size: "4", isDisabled: false})
                    : action.icon}
            </IconContext.Provider>
        </Box>
    );

    return (
        <OverlayAnimated
            isVisible={isOpened}
            disableAnimationIn={true}
            placement={placement === "left" ? "left-start" : "right-start"}
            offset="-1"
            offsetAlong="-1"
            fallbackPlacements={emptyArray}
            onActuallyVisibleChange={action.onOpenChange}
            // Make sure we render over the item's `<FocusRing>`. For example when the user
            // presses the left arrow so the child menu animates closed while the
            // `<FocusRing>` is visible.
            overlayZIndex="10"
            overlay={
                <Box ref={overlayRef}>
                    {hoverTriangleState && (
                        <Box
                            ref={hoverTriangleContainerRef}
                            zIndex="10"
                            position="absolute"
                            top="0"
                            left={placement === "right" ? "0" : undefined}
                            right={placement === "left" ? "0" : undefined}
                            pointerEvents="none"
                        />
                    )}
                    <OverlayScopeContextProvider>
                        <Menu
                            ref={overlayMenuRef}
                            size={action.size ?? size}
                            actions={actions ?? emptyArray}
                            placement={placement === "left" ? "left-start" : "right-start"}
                            onCloseWithAnimation={onCloseWithAnimation}
                            onCloseWithoutAnimation={onCloseWithoutAnimation}
                            isNotFocusable={isNotFocusable}
                            shouldNotCloseAfterActionPress={shouldNotCloseAfterPress}
                            onFocusWithinChange={action.onFocusWithinChange}
                            onArrowLeftKeyDown={event => {
                                if (placement !== "right") return;

                                event.preventDefault();
                                event.stopPropagation();

                                const itemElement = assertExists(itemRef.current);

                                onClose();
                                itemElement.focus({preventScroll: true});
                            }}
                            onArrowRightKeyDown={event => {
                                if (placement !== "left") return;

                                event.preventDefault();
                                event.stopPropagation();

                                const itemElement = assertExists(itemRef.current);

                                onClose();
                                itemElement.focus({preventScroll: true});
                            }}
                        />
                    </OverlayScopeContextProvider>
                </Box>
            }
        >
            <FocusRing isVisible={isFocusRingVisible} offset="inset">
                <Box
                    // eslint-disable-next-line react-compiler/react-compiler
                    {...mergeProps(pressProps, {
                        onPointerEnter: (event: React.PointerEvent<HTMLDivElement>) => {
                            if (
                                event.pointerType === "touch" ||
                                isHovered ||
                                !event.currentTarget.contains(event.target as Element)
                            ) {
                                return;
                            }

                            setIsHovered(true);
                            setHoverTriangleState({
                                initialX: event.clientX,
                                initialY: event.clientY,
                            });
                            event.currentTarget.focus({preventScroll: true});
                            onOpen();
                        },
                        onPointerLeave: (event: React.PointerEvent<HTMLDivElement>) => {
                            if (event.pointerType === "touch" || !isHovered) {
                                return;
                            }

                            setIsHovered(false);
                            event.currentTarget.blur();
                        },
                        onKeyDown: (event: React.KeyboardEvent) => {
                            // When focus is in a `menu` and on a `menuitem` that has a submenu, opens the
                            // submenu and places focus on its first item.
                            //
                            // `ArrowRight` can also open `placement="left"` menus since while the menu is
                            // opened to the left, the arrow icon is pointing to the right. So the user
                            // probably expects the right arrow key to work.
                            //
                            // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
                            if (
                                event.key === "ArrowRight" ||
                                (placement === "left" && event.key === "ArrowLeft")
                            ) {
                                event.preventDefault();
                                event.stopPropagation();

                                setInteractionModality("keyboard");

                                if (!isOpened) {
                                    setShouldInitiallyFocus(true);
                                    onOpen();
                                } else {
                                    const overlayMenuElement = assertExists(overlayMenuRef.current);

                                    getNextFocusableElementIfExists(null, {
                                        withinElement: overlayMenuElement,
                                    })?.focus({preventScroll: true});
                                }
                            }
                        },
                    })}
                    ref={useMergedRefs(itemRef, ref)}
                    id={menuItemId}
                    {...(!isNotFocusable
                        ? {
                              role: "menuitem",
                              // Each item in the menu has `tabindex` set to -1. (Even disabled items
                              // are focusable.)
                              //
                              // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
                              tabIndex: -1,
                          }
                        : {})}
                    minWidth={width}
                    paddingLeft={action.icon ? "1.5" : "2"}
                    paddingRight="1.5"
                    paddingY="1.5"
                    borderRadius="1"
                    color="grey-100"
                    backgroundColor={
                        isPressed || isHoverTrianglePressed
                            ? "grey-10"
                            : isHovered || isOpened
                              ? "grey-5"
                              : undefined
                    }
                    display="flex"
                    alignItems="center"
                    gap="2"
                >
                    {icon}
                    <Box flexGrow="1" fontStyle="truncate">
                        {action.label}
                    </Box>
                    <Box
                        flexShrink="0"
                        width="4"
                        height="4"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                    >
                        {shouldShowPendingSpinner ? (
                            <SpinnerGap
                                className={spinAnimationClassName}
                                size={spacing["4"]}
                                color={colorSchemeVars["grey-70"]}
                            />
                        ) : (
                            <CaretRight
                                color={
                                    isPressed || isHoverTrianglePressed
                                        ? colorSchemeVars["grey-100"]
                                        : colorSchemeVars["grey-80"]
                                }
                                size={spacing["4"]}
                                weight="regular"
                            />
                        )}
                    </Box>
                </Box>
            </FocusRing>
        </OverlayAnimated>
    );
});

/**
 * Hook that returns a ref callback which augments a DOM element with a `press()`
 * method. This allows the `<Menu>` component to programmatically trigger a menu
 * item's action (e.g., when a keyboard shortcut is pressed).
 *
 * @param onPress - The press handler to call when `press()` is invoked
 * @param foreignRef - The ref to forward the augmented element to (from the parent)
 * @returns An object with:
 *   - `localRef`: A ref to the DOM element for internal use
 *   - `refCallback`: A ref callback to pass to the element's `ref` prop
 */
function useMenuItemPressRef(onPress: () => void, foreignRef: Ref<MenuItemRef>) {
    const localRef = useRef<HTMLDivElement>(null);

    // We need to expose `onPress` via the ref's `press()` method so that the
    // `<Menu>` component can trigger it when a keyboard shortcut is pressed.
    // However, `onPress` is recreated on every render since it's defined inside
    // the component and closes over the current props/state. We use a ref to
    // always have access to the latest version of `onPress` without needing to
    // recreate the `press()` method on the DOM element.
    //
    // We use `useLayoutEffectWithoutServerSideWarning` instead of direct
    // assignment (`onPressRef.current = onPress`) because React Compiler forbids
    // writing to ref.current during render.
    const onPressRef = useRef(onPress);
    useLayoutEffectWithoutServerSideWarning(() => {
        onPressRef.current = onPress;
    });

    // This is a ref callback that React calls with the DOM element when mounted
    // and `null` when unmounted. We use it to augment the DOM element with a
    // `press()` method that the `<Menu>` component can call to programmatically
    // trigger this menu item's action.
    //
    // The pattern is:
    // 1. Use `Object.assign` to add a `press()` method directly onto the DOM element
    // 2. The `press()` method calls `onPressRef.current()` to get the latest `onPress`
    // 3. Store the augmented element in both `localRef` (for internal use) and
    //    forward it to `foreignRef` (the parent's ref via `assignRef`)
    //
    // `assignRef` is a helper that handles both `RefObject` and callback ref styles.
    //
    // We use this refCallback instead of foreignRef directly so we can augment
    // the DOM element with the `press()` method before forwarding it to the parent.
    const refCallback = useCallback(
        (element: HTMLDivElement | null) => {
            if (element === null) {
                localRef.current = null;
                assignRef(foreignRef, null);
            } else {
                const actualElement = Object.assign(element, {
                    press: () => {
                        onPressRef.current();
                    },
                });

                localRef.current = actualElement;
                assignRef(foreignRef, actualElement);
            }
        },
        [foreignRef],
    );

    return {localRef, refCallback};
}
