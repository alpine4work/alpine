import {
    AriaAttributes,
    ReactElement,
    Ref,
    forwardRef,
    useCallback,
    useEffect,
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
import {OverlayPlacement, useIsWaitingForOverlayPortalElement} from "~/client/design/overlay.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants.js";
import {
    TooltipCoordinationContextProvider,
    defaultTooltipOffset,
    useShouldDisableTooltips,
} from "~/client/design/tooltip.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {Spacing} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {overlayFadeOutAnimationDurationMs} from "~/shared/styles/styles.js";

export type OverlayTriggerButtonState =
    | {
          readonly isExpanded: false;
          readonly isFadingOut: boolean;
          readonly initiallyFocus?: undefined;
      }
    | {
          readonly isExpanded: true;
          readonly initiallyFocus?: "FirstFocusableElement" | "LastFocusableElement";
          readonly isFadingOut?: undefined;
      };

const initialOverlayTriggerButtonState: OverlayTriggerButtonState = {
    isExpanded: false,
    isFadingOut: false,
};

export type OverlayTriggerButtonChildrenProps = {
    /**
     * Is the overlay currently visible? False if the overlay is fading out.
     */
    isVisible: boolean;
};

export type OverlayTriggerButtonOverlayProps = {
    onCloseWithAnimation: () => void;
    onCloseWithoutAnimation: () => void;
};

let recentOverlayTransitionCoordination:
    | {
          time: number;
          type: "PointerExpand";
      }
    | {
          time: number;
          type: "OutsidePress";
          cancelFadeOut: () => void;
      }
    | null = null;

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
export function OverlayTriggerButton({
    overlay,
    "aria-haspopup": ariaHasPopup,
    placement = "bottom-start",
    offset = defaultTooltipOffset,
    offsetAlong,
    children: actualChildren,
    onStateChange: _onStateChange,
}: {
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
     * Offset of the overlay from the target.
     *
     * Defaults to the same thing as tooltips.
     */
    offset?: Spacing;

    /**
     * How far the overlay should move along the reference.
     *
     * See the [demo][1] here.
     *
     * [1]: https://popper.js.org/docs/v2/modifiers/offset/#demo
     */
    offsetAlong?: Spacing | `-${Spacing}`;

    /**
     * The button element which opens and closes the overlay. Must provide a ref to
     * an HTML `<button>` element or we will throw an error.
     */
    children: ReactElement | ((props: OverlayTriggerButtonChildrenProps) => ReactElement);

    /**
     * Observe the overlay trigger's internal state.
     */
    onStateChange?: (state: OverlayTriggerButtonState) => void;
}) {
    const overlayTriggerRef = useRef<HTMLButtonElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);

    const [state, setState] = useState(initialOverlayTriggerButtonState);

    const onStateChange = useEvent(_onStateChange);
    useEffect(() => {
        onStateChange(state);
    }, [onStateChange, state]);

    // Make sure to unset `state.isFadingOut` once the fade-out duration has
    // finished. That way we actually unmount the overlay in the DOM.
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

    const isWaitingForOverlayPortalElement = useIsWaitingForOverlayPortalElement(state.isExpanded);

    const overlayTriggerLifecycleRef = useCallback(
        (overlayTriggerElement: HTMLButtonElement) => {
            // We require an HTML `<button>` element for accessibility. Another option
            // is allowing arbitrary HTML elements that have the appropriate role and
            // tab-index.
            assert(
                overlayTriggerElement instanceof HTMLButtonElement,
                "Expected the children of `<OverlayTrigger>` to render an element with a ref to an HTML `<button>` element",
            );

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
                if (overlayTriggerElement.disabled) return;

                switch (event.key) {
                    case "ArrowDown": {
                        event.preventDefault(); // Don’t scroll
                        event.stopPropagation();
                        setState({isExpanded: true, initiallyFocus: "FirstFocusableElement"});
                        break;
                    }
                    case "ArrowUp": {
                        event.preventDefault(); // Don’t scroll
                        event.stopPropagation();
                        setState({isExpanded: true, initiallyFocus: "LastFocusableElement"});
                        break;
                    }
                    case "Enter": {
                        event.preventDefault();
                        event.stopPropagation();
                        setState({isExpanded: true, initiallyFocus: "FirstFocusableElement"});
                        break;
                    }
                    case " ": {
                        event.preventDefault(); // Don’t scroll
                        event.stopPropagation();
                        setState({isExpanded: true, initiallyFocus: "FirstFocusableElement"});
                        break;
                    }
                    default:
                        break;
                }
            }

            function handlePointerDown(event: MouseEvent) {
                if (overlayTriggerElement.disabled) return;
                if (isRightClick(event)) return;

                // If we expand an overlay by clicking then other overlays that go away on
                // outside press should not animate out.
                if (!state.isExpanded) {
                    if (
                        recentOverlayTransitionCoordination?.type === "OutsidePress" &&
                        Date.now() - recentOverlayTransitionCoordination.time <
                            perceivedAsInstantLimitMs
                    ) {
                        recentOverlayTransitionCoordination.cancelFadeOut();
                    }

                    recentOverlayTransitionCoordination = {
                        time: Date.now(),
                        type: "PointerExpand",
                    };
                }

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
        [ariaHasPopup, isWaitingForOverlayPortalElement, state.isExpanded],
    );

    // Close the overlay if there’s a click somewhere else in the document outside
    // the overlay or overlay button.
    const outsidePressRef = useOutsidePress(event => {
        if (!state.isExpanded) return;

        const overlayTriggerElement = overlayTriggerRef.current;
        const overlayElement = overlayRef.current;
        const targetElement = event.target as Element;

        if (overlayTriggerElement?.contains(targetElement)) return;
        if (overlayElement?.contains(targetElement)) return;

        setState({
            isExpanded: false,
            // If we expanded an overlay trigger with a pointer click recently, we don't
            // want to fade out our overlay.
            isFadingOut: !(
                recentOverlayTransitionCoordination?.type === "PointerExpand" &&
                Date.now() - recentOverlayTransitionCoordination.time < perceivedAsInstantLimitMs
            ),
        });

        // In case the outside press event happens first, allow a pointer expand to
        // cancel our fade out animation.
        recentOverlayTransitionCoordination = {
            time: Date.now(),
            type: "OutsidePress",
            cancelFadeOut: () => {
                setState(state => {
                    if (state.isExpanded || !state.isFadingOut) return state;
                    return {isExpanded: false, isFadingOut: false};
                });
            },
        };
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

    const onClose = ({
        returnFocusTo,
        withoutAnimation,
    }: {
        returnFocusTo?: "TriggerElement" | "NextElement" | "PreviousElement";
        withoutAnimation?: boolean;
    } = {}) => {
        setState({isExpanded: false, isFadingOut: !withoutAnimation});

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
    };

    return (
        <OverlayAnimated
            isVisible={state.isExpanded}
            placement={placement}
            offset={offset}
            offsetAlong={offsetAlong}
            disableAnimationIn={true}
            disableAnimationOut={state.isExpanded || !state.isFadingOut}
            overlay={
                <OverlayTriggerOverlay
                    ref={useMergedRefs<HTMLDivElement>(overlayRef, outsidePressRef)}
                    overlay={
                        typeof overlay !== "function"
                            ? overlay
                            : overlay({
                                  onCloseWithAnimation: onClose,
                                  onCloseWithoutAnimation: () => onClose({withoutAnimation: true}),
                              })
                    }
                    initiallyFocus={state.initiallyFocus ?? "OverlayElement"}
                    onClose={onClose}
                />
            }
        >
            {children}
        </OverlayAnimated>
    );
}

const OverlayTriggerOverlay = forwardRef(function OverlayTriggerOverlay(
    {
        overlay,
        initiallyFocus,
        onClose,
    }: {
        overlay: ReactElement;
        initiallyFocus: "OverlayElement" | "FirstFocusableElement" | "LastFocusableElement";
        onClose: (options?: {
            returnFocusTo?: "TriggerElement" | "NextElement" | "PreviousElement";
            withoutAnimation?: boolean;
        }) => void;
    },
    ref: Ref<HTMLDivElement>,
) {
    const overlayRef = useRef<HTMLElement>(null);

    const hasInitiallyRenderedRef = useRef(false);

    useLayoutEffect(() => {
        if (hasInitiallyRenderedRef.current) return;
        hasInitiallyRenderedRef.current = true;

        assert(
            overlayRef.current instanceof HTMLElement,
            "Expected the overlay prop of an `<OverlayTrigger>` component to render an element with a ref to an HTML element",
        );
        const overlayElement = overlayRef.current;

        switch (initiallyFocus) {
            case "OverlayElement": {
                if (overlayElement.matches(focusableElementSelector)) {
                    overlayElement.focus({preventScroll: true});
                    break;
                }

                // Intentional fallthrough to next case...
            }
            case "FirstFocusableElement": {
                getNextFocusableElementIfExists(null, {
                    withinElement: overlayElement,
                })?.focus({preventScroll: true});
                break;
            }
            case "LastFocusableElement": {
                getLastFocusableElementIfExists({withinElement: overlayElement})?.focus({
                    preventScroll: true,
                });
                break;
            }
            default:
                throw exhaustive(initiallyFocus);
        }
    }, [initiallyFocus]);

    // While the overlay is open, we want to disable all other tooltips in the
    // application.
    useShouldDisableTooltips();

    return (
        // While tooltips are disabled outside our overlay, we still want to allow
        // tooltips within our overlay.
        <TooltipCoordinationContextProvider>
            <div
                ref={ref}
                onKeyDown={event => {
                    switch (event.key) {
                        // Close the menu that contains focus and return focus to the element
                        // or context, e.g., menu button, from which the menu was opened.
                        //
                        // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                        case "Escape": {
                            event.preventDefault();
                            event.stopPropagation();
                            onClose({returnFocusTo: "TriggerElement"});
                            return;
                        }
                        // Moves focus to the next (or previous) element in the tab sequence,
                        // and closes its `menu` and all open parent menu containers.
                        //
                        // https://www.w3.org/TR/wai-aria-practices-1.2/#menu
                        case "Tab": {
                            event.preventDefault();
                            event.stopPropagation();
                            onClose({
                                returnFocusTo: event.shiftKey ? "PreviousElement" : "NextElement",
                            });
                            return;
                        }
                    }
                }}
            >
                {useElementWithRef(overlay, overlayRef)}
            </div>
        </TooltipCoordinationContextProvider>
    );
});

function isRightClick(event: MouseEvent) {
    return event.which === 3 || event.button === 2;
}
