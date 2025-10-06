import {setInteractionModality} from "@react-aria/interactions";
import {AnimationPlaybackControls} from "motion";
import {
    AriaAttributes,
    Memo,
    ReactElement,
    Ref,
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {
    focusableElementSelector,
    getLastFocusableElementIfExists,
    getNextFocusableElementIfExists,
    getPreviousFocusableElementIfExists,
} from "~/client/design/helpers/get_next_focusable_element.js";
import {setElementAttributesWithCleanup} from "~/client/design/helpers/set_element_attributes_with_cleanup.js";
import {useOutsidePress} from "~/client/design/helpers/use_outside_interaction.js";
import {useShouldDisableTooltips} from "~/client/design/internal/tooltip_coordination_context.js";
import {OverlayPlacement} from "~/client/design/overlay.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {useIsWaitingForOverlayPortalElement} from "~/client/design/overlay_helpers.js";
import {
    dispatchTriggeredOverlayCloseEvent,
    dispatchTriggeredOverlayOpenEvent,
} from "~/client/design/overlay_trigger_button_event_listeners.js";
import {defaultTooltipOffset} from "~/client/design/tooltip.js";
import {TooltipCoordinationContextProvider} from "~/client/design/tooltip_coordination_context_provider.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {isElementOwnedBy} from "~/client/helpers/elements/is_element_owned_by.js";
import {useEvent, useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {ParsableRemLength} from "~/shared/design/core/spacing.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {noop} from "~/shared/helpers/control/noop.js";

export type OverlayTriggerButtonRef = {
    open(options?: {
        initiallyFocus?: "FirstFocusableElement" | "LastFocusableElement";
        stopPropagation?: boolean;
    }): void;
    close(options?: {
        returnFocusTo?: "TriggerElement" | "NextElement" | "PreviousElement";
        withoutAnimation?: boolean;
    }): void;
};

export type OverlayTriggerButtonState =
    | {
          readonly isExpanded: false;
          readonly disableAnimationOut: boolean;
          readonly initiallyFocus?: undefined;
      }
    | {
          readonly isExpanded: true;
          readonly initiallyFocus?: "FirstFocusableElement" | "LastFocusableElement";
          readonly disableAnimationOut?: undefined;
      };

const initialOverlayTriggerButtonState: OverlayTriggerButtonState = {
    isExpanded: false,
    disableAnimationOut: false,
};

export type OverlayTriggerButtonChildrenProps = {
    /**
     * Is the overlay currently visible? False if the overlay is fading out.
     */
    isVisible: boolean;
};

export type OverlayTriggerButtonOverlayProps = {
    isVisible: boolean;
    onCloseWithAnimation: Memo<() => void>;
    onCloseWithoutAnimation: Memo<() => void>;
};

const OverlayTriggerButtonForwardRef = forwardRef(OverlayTriggerButton);
export {OverlayTriggerButtonForwardRef as OverlayTriggerButton};

/**
 * An overlay trigger button opens an overlay when pressed and moves focus into
 * that overlay.
 *
 * The most common implementation of an overlay trigger button is
 * `<MenuButton>`. But we have this lower level component for implementing
 * other menu-like things.
 */
// We quote the pieces of the [WAI-ARIA menu button pattern][1] we implement in
// this source code.
//
// [1]: https://www.w3.org/TR/wai-aria-practices-1.2/#menubutton
function OverlayTriggerButton(
    {
        isDisabled = false,
        overlay,
        "aria-haspopup": ariaHasPopup,
        placement = "bottom-start",
        fallbackPlacements,
        offset = defaultTooltipOffset,
        offsetAlong,
        withoutButtonElementRequirement = false,
        children: actualChildren,
        onOpen: onOpenFromProps,
        onClose: onCloseFromProps,
        onStateChange: onStateChangeFromProps,
        onPointerDown: onPointerDownFromProps,
        onActuallyVisibleChange,
        onOverlayEscapeGlobalKeyDown,
        onOverlayTabGlobalKeyDown,
        onOverlayOutsidePress,
        animateOverlayOut: animateOverlayOutFromProps,
    }: {
        /**
         * If true then the overlay is closed and won't open when the button
         * is pressed.
         */
        isDisabled?: boolean;

        /**
         * The overlay element the trigger will render. Must provide a ref to an
         * HTML element or we will throw an error.
         */
        overlay: ReactElement | ((props: OverlayTriggerButtonOverlayProps) => ReactElement);

        /**
         * You must specify the kind of popup opened by the trigger based on the
         * aria specification.
         */
        "aria-haspopup": NonNullable<AriaAttributes["aria-haspopup"]>;

        /**
         * Where should the overlay be placed relative to the target element?
         * Defaults to `bottom-start`.
         */
        placement?: OverlayPlacement;

        /**
         * Placements to try if `placement` would put the overlay out of bounds. If
         * it's an empty array then the overlay will never flip from `placement`.
         *
         * If undefined the overlay can flip anywhere.
         *
         * Does not work with the special `center` placement.
         */
        fallbackPlacements?: ReadonlyArray<OverlayPlacement>;

        /**
         * Offset of the overlay from the target.
         *
         * Defaults to the same thing as tooltips.
         */
        offset?: ParsableRemLength;

        /**
         * How far the overlay should move along the reference.
         *
         * See the [demo][1] here.
         *
         * [1]: https://popper.js.org/docs/v2/modifiers/offset/#demo
         */
        offsetAlong?: ParsableRemLength;

        /**
         * Disable the requirement that `children` must be a `<button>` element.
         */
        withoutButtonElementRequirement?: boolean;

        /**
         * The button element which opens and closes the overlay. Must provide a ref to
         * an HTML `<button>` element or we will throw an error.
         */
        children: ReactElement | ((props: OverlayTriggerButtonChildrenProps) => ReactElement);

        /**
         * Called before the overlay opens. Like when the button is clicked with a
         * mouse or focused and had "Enter" pressed. You can stop the overlay from
         * opening by returning `{preventDefault: true}`. For example, if you need to
         * load some data.
         */
        onOpen?: () => {preventDefault: boolean} | void;

        /**
         * Called before the overlay closes. Like when a click happens outside the
         * overlay.
         */
        onClose?: (options: {withoutAnimation: boolean}) => void;

        /**
         * Observe the overlay trigger's internal state after the state has changed.
         * Different from `onOpen` which is only called before the overlay opens.
         */
        onStateChange?: (state: OverlayTriggerButtonState) => void;

        /**
         * Observe when the overlay trigger's internal overlay actually switches
         * between visible true and visible false. Will only call this with false once
         * the overlay has finished animating.
         */
        onActuallyVisibleChange?: (isActuallyVisible: boolean) => void;

        /**
         * Called when the `pointerdown` event is dispatched on the overlay trigger
         * button. Called by a DOM event listener, not a React synthetic event
         * listener. Called before the overlay opens.
         */
        onPointerDown?: (event: PointerEvent) => void;

        /**
         * Called when the escape key is pressed while our overlay is open. Can be used
         * to prevent the default `<OverlayTriggerButton>` behavior on escape key down.
         */
        onOverlayEscapeGlobalKeyDown?: (event: KeyboardEvent) => void | {allowDefault: boolean};

        /**
         * Called when the tab key is pressed while our overlay is open. Can be used to
         * prevent the default `<OverlayTriggerButton>` behavior on tab key down.
         */
        onOverlayTabGlobalKeyDown?: (event: KeyboardEvent) => void | {allowDefault: boolean};

        /**
         * Called when the user presses outside the overlay. Allows you to prevent
         * closing the overlay on outside press.
         */
        onOverlayOutsidePress?: () => void | {preventDefault: boolean};

        /**
         * Custom fade out animation for the overlay. The overlay will actually close
         * once the animation finishes.
         */
        animateOverlayOut?: () => AnimationPlaybackControls;
    },
    ref: Ref<OverlayTriggerButtonRef>,
) {
    const overlayTriggerRef = useRef<HTMLButtonElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);

    const [state, setState] = useState(initialOverlayTriggerButtonState);

    // If the button is disabled then close the overlay (with an animation out).
    if (state.isExpanded && isDisabled) {
        setState({isExpanded: false, disableAnimationOut: false});
    }

    const {
        onOpen,
        onClose,
        onStateChange,
        onPointerDown,
        animateOverlayOut,
        open,
        close,
        closeWithoutAnimation,
    } = useEvents({
        onOpen: cast<() => {preventDefault: boolean} | void>(onOpenFromProps ?? noop),
        onClose: onCloseFromProps ?? noop,
        onStateChange: onStateChangeFromProps ?? noop,
        onPointerDown: onPointerDownFromProps ?? noop,
        animateOverlayOut:
            animateOverlayOutFromProps ??
            ((): never => {
                throw new UnimplementedError("Unreachable");
            }),

        open: ({initiallyFocus, stopPropagation = false} = {}) => {
            if (isDisabled) return;
            if (state.isExpanded) return;

            // Borrowing the language of DOM event handling here. `onOpen` may
            // `preventDefault` stopping expansion from actually happening. But when you
            // call `open()` you may `stopPropagation` to prevent the `onOpen` callback
            // (which may `preventDefault`) from being called.
            if (stopPropagation) {
                setState({isExpanded: true, initiallyFocus});
            } else {
                const result = onOpenFromProps?.();
                if (typeof result === "object" && result.preventDefault) {
                    // Do nothing if default was prevented...
                } else {
                    setState({isExpanded: true, initiallyFocus});
                }
            }
        },

        close: ({
            returnFocusTo,
            withoutAnimation = false,
        }: {
            returnFocusTo?: "TriggerElement" | "NextElement" | "PreviousElement";
            withoutAnimation?: boolean;
        } = {}) => {
            if (isDisabled) return;
            if (!state.isExpanded) return;

            onClose({withoutAnimation});

            setState({isExpanded: false, disableAnimationOut: withoutAnimation});

            // If we unmounted before calling `onClose` (due to some async race condition)
            // don't focus anything.
            if (!overlayTriggerRef.current) return;

            const overlayTriggerElement = overlayTriggerRef.current;

            switch (returnFocusTo) {
                case "TriggerElement": {
                    overlayTriggerElement.focus({preventScroll: true});
                    break;
                }
                case "NextElement": {
                    getNextFocusableElementIfExists(overlayTriggerElement)?.focus({
                        preventScroll: true,
                    });
                    break;
                }
                case "PreviousElement": {
                    getPreviousFocusableElementIfExists(overlayTriggerElement)?.focus({
                        preventScroll: true,
                    });
                    break;
                }
                case undefined: {
                    break;
                }
                default:
                    throw exhaustive(returnFocusTo);
            }
        },
        closeWithoutAnimation: () => {
            close({withoutAnimation: true});
        },
    });

    useEffect(() => {
        onStateChange(state);
    }, [onStateChange, state]);

    useImperativeHandle(ref, () => ({open, close}), [open, close]);

    const isWaitingForOverlayPortalElement = useIsWaitingForOverlayPortalElement(state.isExpanded);

    const overlayTriggerLifecycleRef = useCallback(
        (overlayTriggerElement: HTMLElement) => {
            // We require an HTML `<button>` element for accessibility. Another option
            // is allowing arbitrary HTML elements that have the appropriate role and
            // tab-index.
            if (withoutButtonElementRequirement) {
                assert(
                    overlayTriggerElement instanceof HTMLElement,
                    "Expected the children of `<OverlayTrigger>` to render with a ref to an element",
                );
            } else {
                assert(
                    overlayTriggerElement instanceof HTMLButtonElement,
                    "Expected the children of `<OverlayTrigger>` to render with a ref to an HTML `<button>` element",
                );
            }

            if (isDisabled) return;

            // If the overlay portal element is not ready then `overlayRef` will not have
            // mounted yet even if `state.isExpanded` is true.
            assert(!state.isExpanded || isWaitingForOverlayPortalElement || overlayRef.current);
            const overlayElement = overlayRef.current;

            // - With focus on the button:
            //   - Enter: opens the menu and places focus on the first menu item.
            //   - Space: Opens the menu and places focus on the first menu item.
            //   - (Optional) Down Arrow: opens the menu and moves focus to the first menu item.
            //   - (Optional) Up Arrow: opens the menu and moves focus to the last menu item.
            //
            // https://www.w3.org/TR/wai-aria-practices-1.2/#keyboard-interaction-13
            function handleKeyDown(event: KeyboardEvent) {
                if (state.isExpanded) return;
                if (
                    overlayTriggerElement instanceof HTMLButtonElement &&
                    overlayTriggerElement.disabled
                )
                    return;

                switch (event.key) {
                    case "ArrowDown": {
                        event.preventDefault(); // Don’t scroll
                        event.stopPropagation();

                        const result = onOpen();
                        if (typeof result === "object" && result.preventDefault) {
                            // Do nothing if default was prevented...
                        } else {
                            setInteractionModality("keyboard");
                            setState({isExpanded: true, initiallyFocus: "FirstFocusableElement"});
                        }
                        break;
                    }
                    case "ArrowUp": {
                        event.preventDefault(); // Don’t scroll
                        event.stopPropagation();

                        const result = onOpen();
                        if (typeof result === "object" && result.preventDefault) {
                            // Do nothing if default was prevented...
                        } else {
                            setInteractionModality("keyboard");
                            setState({isExpanded: true, initiallyFocus: "LastFocusableElement"});
                        }
                        break;
                    }
                    case "Enter": {
                        event.preventDefault();
                        event.stopPropagation();

                        const result = onOpen();
                        if (typeof result === "object" && result.preventDefault) {
                            // Do nothing if default was prevented...
                        } else {
                            setInteractionModality("keyboard");
                            setState({isExpanded: true, initiallyFocus: "FirstFocusableElement"});
                        }
                        break;
                    }
                    case " ": {
                        event.preventDefault(); // Don’t scroll
                        event.stopPropagation();

                        const result = onOpen();
                        if (typeof result === "object" && result.preventDefault) {
                            // Do nothing if default was prevented...
                        } else {
                            setInteractionModality("keyboard");
                            setState({isExpanded: true, initiallyFocus: "FirstFocusableElement"});
                        }
                        break;
                    }
                    default:
                        break;
                }
            }

            let isPointerDown = false;

            function pointerExpand() {
                if (state.isExpanded) return;

                const result = onOpen();
                if (typeof result === "object" && result.preventDefault) {
                    // Do nothing if default was prevented...
                } else {
                    setState({isExpanded: true});
                }
            }

            function handlePointerDown(event: PointerEvent) {
                if (
                    overlayTriggerElement instanceof HTMLButtonElement &&
                    overlayTriggerElement.disabled
                ) {
                    return;
                }

                if (isRightClick(event)) return;

                isPointerDown = true;

                onPointerDown?.(event);

                // Expand on `pointerdown` if this is the mouse. Expand on `pointerup` if this
                // is touch. Because a touch press gesture might actually be a scroll. If the
                // user starts scrolling that cancels our press.
                if (event.pointerType === "mouse") {
                    pointerExpand();
                }
            }

            function handlePointerUp(event: PointerEvent) {
                const wasPointerDown = isPointerDown;
                isPointerDown = false;

                // Expand on `pointerdown` if this is the mouse. Expand on `pointerup` if this
                // is touch. Because a touch press gesture might actually be a scroll. If the
                // user starts scrolling that cancels our press.
                if (wasPointerDown && event.pointerType !== "mouse") {
                    pointerExpand();
                }
            }

            function handlePointerCancel() {
                isPointerDown = false;
            }

            const overlayId = overlayElement?.getAttribute("id") ?? null;

            const overlayTriggerId =
                overlayTriggerElement.getAttribute("id") ??
                (overlayId !== null ? `${overlayId}-trigger` : null);

            const cleanupOverlayTriggerAttributes = setElementAttributesWithCleanup(
                overlayTriggerElement,
                {
                    // If the button already has an ID, we won’t override that.
                    id: overlayTriggerId,
                    // - The element that opens the overlay has role button.
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
                    "aria-haspopup": String(ariaHasPopup),
                    "aria-expanded": state.isExpanded ? "true" : null,
                    "aria-controls": overlayId,
                },
            );

            const cleanupOverlayAttributes = overlayElement
                ? setElementAttributesWithCleanup(overlayElement, {
                      // An element with role menu has `aria-labelledby` set to a value
                      // that refers to the button that controls its display.
                      //
                      // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                      //
                      // We have to set this in our lifecycle ref because we don’t have
                      // the button’s ID at render time.
                      "aria-labelledby": overlayTriggerId,
                  })
                : null;

            // Needs to be capture phase because `usePress()` will prevent default and stop
            // propagation on press events.
            overlayTriggerElement.addEventListener("pointerdown", handlePointerDown, {
                capture: true,
            });
            overlayTriggerElement.addEventListener("pointerup", handlePointerUp, {
                capture: true,
            });
            overlayTriggerElement.addEventListener("pointermove", handlePointerCancel, {
                capture: true,
            });
            overlayTriggerElement.addEventListener("pointercancel", handlePointerCancel, {
                capture: true,
            });
            overlayTriggerElement.addEventListener("dragstart", handlePointerCancel);
            overlayTriggerElement.addEventListener("keydown", handleKeyDown);

            return () => {
                cleanupOverlayTriggerAttributes();
                cleanupOverlayAttributes?.();

                overlayTriggerElement.removeEventListener("pointerdown", handlePointerDown, {
                    capture: true,
                });
                overlayTriggerElement.removeEventListener("keydown", handleKeyDown);
            };
        },
        [
            ariaHasPopup,
            isDisabled,
            isWaitingForOverlayPortalElement,
            onOpen,
            onPointerDown,
            state.isExpanded,
            withoutButtonElementRequirement,
        ],
    );

    // Close the overlay if there’s a click somewhere else in the document outside
    // the overlay or overlay button.
    const outsidePressRef = useOutsidePress(event => {
        if (isDisabled) return;
        if (!state.isExpanded) return;

        const overlayTriggerElement = overlayTriggerRef.current;
        const overlayElement = overlayRef.current;
        const targetElement = event.target as Element;

        if (overlayTriggerElement?.contains(targetElement)) return;
        if (overlayElement?.contains(targetElement)) return;

        const result = onOverlayOutsidePress?.();
        if (result?.preventDefault) return;

        // Courtesy blur call if the focused element is in the overlay. Useful on
        // mobile Safari since if the focused element is removed from the DOM there
        // won't be a `focusout` event.
        if (
            overlayElement &&
            document.activeElement instanceof HTMLElement &&
            isElementOwnedBy(overlayElement, document.activeElement)
        ) {
            document.activeElement.blur();
        }

        onClose({withoutAnimation: false});

        setState({
            isExpanded: false,
            disableAnimationOut: false,
        });
    });

    const children = useElementWithRef(
        useMemo(() => {
            if (typeof actualChildren !== "function") {
                return actualChildren;
            } else {
                return actualChildren({isVisible: state.isExpanded});
            }
        }, [actualChildren, state.isExpanded]),
        useMergedRefs(overlayTriggerRef, useLifecycleRef(overlayTriggerLifecycleRef)),
    );

    const pendingTriggeredOverlayCloseRef = useRef<(() => void) | null>(null);

    return (
        <OverlayAnimated
            // Menus opened with `<OverlayTriggerButton>` block you from interacting with
            // content below the overlay.
            isBlocking={true}
            isVisible={state.isExpanded}
            placement={placement}
            fallbackPlacements={fallbackPlacements}
            offset={offset}
            offsetAlong={offsetAlong}
            disableAnimationIn={true}
            disableAnimationOut={state.disableAnimationOut}
            animateOut={animateOverlayOutFromProps !== undefined ? animateOverlayOut : undefined}
            overlay={
                <OverlayTriggerButtonOverlay
                    ref={useMergedRefs<HTMLDivElement>(overlayRef, outsidePressRef)}
                    overlay={
                        typeof overlay !== "function"
                            ? overlay
                            : overlay({
                                  isVisible: state.isExpanded,
                                  onCloseWithAnimation: close,
                                  onCloseWithoutAnimation: closeWithoutAnimation,
                              })
                    }
                    initiallyFocus={state.initiallyFocus ?? "OverlayElement"}
                    onClose={close}
                    onEscapeGlobalKeyDown={onOverlayEscapeGlobalKeyDown}
                    onTabGlobalKeyDown={onOverlayTabGlobalKeyDown}
                />
            }
            onActuallyVisibleChange={isActuallyVisible => {
                const overlayTriggerElement = overlayTriggerRef.current;
                if (overlayTriggerElement) {
                    if (pendingTriggeredOverlayCloseRef.current !== null) {
                        pendingTriggeredOverlayCloseRef.current();
                        pendingTriggeredOverlayCloseRef.current = null;
                    }

                    // Overlay trigger buttons may attach custom event listeners to their DOM
                    // element if they'd like to know if their overlay is open or closed.
                    if (isActuallyVisible) {
                        dispatchTriggeredOverlayOpenEvent(overlayTriggerElement);
                    } else {
                        if (state.disableAnimationOut) {
                            dispatchTriggeredOverlayCloseEvent(overlayTriggerElement);
                        } else {
                            pendingTriggeredOverlayCloseRef.current = () => {
                                dispatchTriggeredOverlayCloseEvent(overlayTriggerElement);
                            };

                            // The double `requestAnimationFrame()` is for overlay triggers which use
                            // `<IconButton variant="quiet">` or `<Button variant="quiet">`. These
                            // components show a background color when they're either hovered or their
                            // overlay is open. When their overlay is open, because `isBlocking` is true
                            // there's a cover element over the DOM to prevent pointer interactions from
                            // going to the underlying UI. When the overlay closes, this cover element is
                            // removed and `pointerover` is fired on the button (if the mouse hasn't moved)
                            // so it considers itself hovered again. However, there's a small delay between
                            // the cover being removed and `pointerover` being fired. Two animation frames
                            // of delay in fact. So wait two animation frames so the button's background
                            // doesn't flicker when the overlay closes.
                            //
                            // Video reproduction of the bug:
                            // https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/abaeqqrmkpetc1x1wm0nkzfbbc
                            //
                            // However, if the overlay was closed without animation then we want to remove
                            // the background color on our button the same frame the overlay closes. Which
                            // is why we make sure `state.disableAnimationOut` is false before entering
                            // this code path.
                            requestAnimationFrame(() => {
                                requestAnimationFrame(() => {
                                    if (pendingTriggeredOverlayCloseRef.current !== null) {
                                        pendingTriggeredOverlayCloseRef.current();
                                        pendingTriggeredOverlayCloseRef.current = null;
                                    }
                                });
                            });
                        }
                    }
                }

                onActuallyVisibleChange?.(isActuallyVisible);
            }}
        >
            {children}
        </OverlayAnimated>
    );
}

let isReDispatchingKeyboardEvent = false;

const OverlayTriggerButtonOverlay = forwardRef(function OverlayTriggerButtonOverlay(
    {
        overlay,
        initiallyFocus,
        onClose,
        onEscapeGlobalKeyDown,
        onTabGlobalKeyDown,
    }: {
        overlay: ReactElement;
        initiallyFocus: "OverlayElement" | "FirstFocusableElement" | "LastFocusableElement";
        onClose: (options?: {
            returnFocusTo?: "TriggerElement" | "NextElement" | "PreviousElement";
            withoutAnimation?: boolean;
        }) => void;
        onEscapeGlobalKeyDown?: (event: KeyboardEvent) => void | {allowDefault: boolean};
        onTabGlobalKeyDown?: (event: KeyboardEvent) => void | {allowDefault: boolean};
    },
    externalRef: Ref<HTMLDivElement>,
) {
    const overlayRef = useRef<HTMLElement>(null);

    const hasInitiallyMountedRef = useRef(false);

    useLayoutEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        assert(
            overlayRef.current instanceof HTMLElement,
            "Expected the overlay prop of an `<OverlayTrigger>` component to render an element with a ref to an HTML element",
        );
        const overlayElement = overlayRef.current;

        const run = () => {
            switch (initiallyFocus) {
                case "OverlayElement": {
                    if (overlayElement.matches(focusableElementSelector)) {
                        overlayElement.focus({preventScroll: true});
                        break;
                    }

                    // Intentional fallthrough to next case...
                }
                case "FirstFocusableElement": {
                    // NOTE(calebmer): For some reason for iOS Safari to render the text caret in
                    // a focused input we need to wait an animation frame before calling `focus()`.
                    // Otherwise we focus but don't show the cursor. This happens with the task
                    // collection filter editor.
                    if (!isMobileWebKit) {
                        getNextFocusableElementIfExists(null, {
                            withinElement: overlayElement,
                        })?.focus({preventScroll: true});
                    } else {
                        requestAnimationFrame(() => {
                            getNextFocusableElementIfExists(null, {
                                withinElement: overlayElement,
                            })?.focus({preventScroll: true});
                        });
                    }
                    break;
                }
                case "LastFocusableElement": {
                    // NOTE(calebmer): For some reason for iOS Safari to render the text caret in
                    // a focused input we need to wait an animation frame before calling `focus()`.
                    // Otherwise we focus but don't show the cursor. This happens with the task
                    // collection filter editor.
                    if (!isMobileWebKit) {
                        getLastFocusableElementIfExists({withinElement: overlayElement})?.focus({
                            preventScroll: true,
                        });
                    } else {
                        requestAnimationFrame(() => {
                            getLastFocusableElementIfExists({withinElement: overlayElement})?.focus(
                                {
                                    preventScroll: true,
                                },
                            );
                        });
                    }
                    break;
                }
                default:
                    throw exhaustive(initiallyFocus);
            }
        };

        // Focus after a microtask. This allows any parent layout effects to run. Which
        // is important since our parent component `<Overlay>`'s layout effects need to
        // run for the `data-ownedby` attribute to be set and Popper to run its layout.
        scheduleMicrotask(run);
    }, [initiallyFocus]);

    // While the overlay is open, we want to disable all other tooltips in the
    // application.
    useShouldDisableTooltips();

    // Our overlay opened by an overlay trigger blocks all other UI on the page
    // with the `isBlocking` prop on `<Overlay>`. It should consume all keyboard
    // events as well.
    //
    // If we can't handle a key event, we dispatch call `dispatchEvent()` on our
    // overlay element so it can handle the event.
    const handleGlobalKeyDown = useEvent((event: KeyboardEvent) => {
        // If we're re-dispatching a `keydown` event then don't run our handler again.
        if (isReDispatchingKeyboardEvent) return;

        switch (event.key) {
            // Close the menu that contains focus and return focus to the element
            // or context, e.g., menu button, from which the menu was opened.
            //
            // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
            case "Escape": {
                const result = onEscapeGlobalKeyDown?.(event);

                if (!event.defaultPrevented && !result?.allowDefault) {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose({returnFocusTo: "TriggerElement"});
                }
                return;
            }
            // Moves focus to the next (or previous) element in the tab sequence,
            // and closes its `menu` and all open parent menu containers.
            //
            // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
            case "Tab": {
                const result = onTabGlobalKeyDown?.(event);

                if (!event.defaultPrevented && !result?.allowDefault) {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose({
                        returnFocusTo: event.shiftKey ? "PreviousElement" : "NextElement",
                    });
                }
                return;
            }

            default: {
                const overlayElement = assertExists(overlayRef.current);

                // If focus is already within the overlay then we don't need to
                // re-dispatch the event. The event will already be dispatched
                // properly.
                //
                // TODO(calebmer): To be honest, I've forgotten what the purpose of this
                // re-dispatching code was. Was it to prevent `keydown` events from bubbling up
                // to `<GlobalKeyDownEvent>` components? Consider removing this code entirely
                // if we can't figure out how it's used.
                if (
                    document.activeElement &&
                    isElementOwnedBy(overlayElement, document.activeElement)
                ) {
                    return;
                }

                event.stopPropagation();

                // Allow our overlay element to handle the keyboard event but don't let anyone
                // else handle keyboard events.
                isReDispatchingKeyboardEvent = true;
                try {
                    const newEvent = new KeyboardEvent("keydown", event);

                    // If focus is within the overlay then dispatch the keyboard event from the
                    // focused element. Otherwise dispatch it from the overlay root.
                    (document.activeElement &&
                    isElementOwnedBy(overlayElement, document.activeElement)
                        ? document.activeElement
                        : overlayElement
                    ).dispatchEvent(newEvent);

                    if (newEvent.defaultPrevented) {
                        event.preventDefault();
                    }
                } finally {
                    isReDispatchingKeyboardEvent = false;
                }
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
        // While tooltips are disabled outside our overlay, we still want to allow
        // tooltips within our overlay.
        <TooltipCoordinationContextProvider>
            {useElementWithRef(overlay, useMergedRefs(overlayRef, externalRef))}
        </TooltipCoordinationContextProvider>
    );
});

function isRightClick(event: MouseEvent) {
    return event.which === 3 || event.button === 2;
}
