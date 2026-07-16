import {isFocusVisible} from "@react-aria/interactions";
import {AnimationPlaybackControls, animate} from "motion";
import {
    ReactElement,
    ReactNode,
    Ref,
    forwardRef,
    useCallback,
    useContext,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/web/design/box.js";
import {setElementAttributesWithCleanup} from "~/client/web/design/helpers/set_element_attributes_with_cleanup.js";
import {
    TooltipCoordinationActiveSymbolContext,
    TooltipCoordinationContext,
    tooltipCoordinationContextForTest,
} from "~/client/web/design/internal/tooltip_coordination_context.js";
import {Overlay, OverlayPlacement, OverlayRef} from "~/client/web/design/overlay.js";
import {useIsWaitingForOverlayPortalElement} from "~/client/web/design/overlay_helpers.js";
import {useConstant} from "~/client/web/helpers/lifecycle/use_constant.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useIsMounted} from "~/client/web/helpers/lifecycle/use_is_mounted.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useElementWithRef} from "~/client/web/helpers/refs/use_element_with_ref.js";
import {useLifecycleRef} from "~/client/web/helpers/refs/use_lifecycle_ref.js";
import {useCanPrimaryInputHover} from "~/client/web/remix/platform_context.js";
import {
    overlayAnimateContainerClassName,
    overlayAnimateFadeInClassName,
    overlayFadeInAnimationDurationMs,
    overlayFadeInOutTimingFunction,
    overlayFadeOutAnimationDurationMs,
} from "~/client/web/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {parseCubicBezier} from "~/shared/design/core/easing.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Time it takes before we present a tooltip to the user if the user has not taken
 * another action.
 *
 * If the user hovers over a button for this amount of time, we present a tooltip.
 * If the user's mouse is quickly moving around then we don't present a tooltip
 * because the user is taking quick action and doesn't appear to need extra
 * context.
 */
export const tooltipDelayMs = 1000;

export type TooltipState =
    // Tooltip is definitely not visible.
    | {
          readonly isHovered: false;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: false;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is disabled.
    | {
          readonly isHovered: false;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: true;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is fading in but we no longer have hover/focus so once the fade in is
    // done we will immediately transition to fading out.
    | {
          readonly isHovered: false;
          readonly isFocused: false;
          readonly isFadingIn: true;
          readonly isFadingOut: false;
          readonly isDisabled: false;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is fading out.
    | {
          readonly isHovered: false;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: true;
          readonly isDisabled: false;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is fading out and disabled.
    | {
          readonly isHovered: false;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: true;
          readonly isDisabled: true;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is hovered.
    | {
          readonly isHovered: true;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: false;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is focused.
    | {
          readonly isHovered: false;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: false;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is hovered and focused.
    | {
          readonly isHovered: true;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: false;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is hovered and disabled.
    | {
          readonly isHovered: true;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: true;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is focused and disabled.
    | {
          readonly isHovered: false;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: true;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is hovered and focused and disabled.
    | {
          readonly isHovered: true;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: true;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is hovered and fading in.
    | {
          readonly isHovered: true;
          readonly isFocused: false;
          readonly isFadingIn: true;
          readonly isFadingOut: false;
          readonly isDisabled: false;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is focused and fading in.
    | {
          readonly isHovered: false;
          readonly isFocused: true;
          readonly isFadingIn: true;
          readonly isFadingOut: false;
          readonly isDisabled: false;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is hovered and focused and fading in.
    | {
          readonly isHovered: true;
          readonly isFocused: true;
          readonly isFadingIn: true;
          readonly isFadingOut: false;
          readonly isDisabled: false;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is hovered and fading out. Can only fade out while hovered when
    // disabled.
    | {
          readonly isHovered: true;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: true;
          readonly isDisabled: true;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is focused and fading out. Can only fade out while focused when
    // disabled.
    | {
          readonly isHovered: false;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: true;
          readonly isDisabled: true;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip is hovered and focused and fading out. Can only fade out while hovered
    // and focused when disabled.
    | {
          readonly isHovered: true;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: true;
          readonly isDisabled: true;
          readonly hadHidingPointerDownWhileHovered: false;
      }
    // Tooltip has been clicked while hovered. This will hide the tooltip without
    // animating it.
    | {
          readonly isHovered: true;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: false;
          readonly hadHidingPointerDownWhileHovered: true;
      }
    // Tooltip has been clicked while hovered and focused. This will hide the tooltip
    // without animating it.
    | {
          readonly isHovered: true;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: false;
          readonly hadHidingPointerDownWhileHovered: true;
      }
    // Tooltip has been clicked while hovered and disabled. This will hide the tooltip
    // without animating it.
    | {
          readonly isHovered: true;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: true;
          readonly hadHidingPointerDownWhileHovered: true;
      }
    // Tooltip has been clicked while hovered, focused, and disabled. This will hide
    // the tooltip without animating it.
    | {
          readonly isHovered: true;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: true;
          readonly hadHidingPointerDownWhileHovered: true;
      };

type TooltipChildrenProps = {
    /**
     * Is the tooltip currently visible? True even when the tooltip is fading in and
     * out of visibility.
     */
    isVisible: boolean;

    /**
     * When hovering over a tooltip, we have a delay before the tooltip becomes visible
     * to make sure the user's mouse wasn't quickly moving over the tooltip. Calling
     * this function skips that delay.
     */
    skipHoverDelay: () => void;
};

export type TooltipRef = {
    /**
     * Force the tooltip to update its position.
     */
    forceUpdateTooltipPosition(): void;

    /**
     * Skip the hover delay and immediately show our tooltip.
     */
    skipTooltipHoverDelay(): void;

    /**
     * Skip the hover delay and immediately show our tooltip without animating in.
     */
    skipTooltipHoverDelayAndAnimation(): void;
};

const TooltipForwardRef = forwardRef(Tooltip);
export {TooltipForwardRef as Tooltip};

export type TooltipProps = {
    /**
     * The contents of the tooltip. We expect this to be text most of the time.
     */
    content: ReactNode;

    /**
     * If true the tooltip won't open even if the target element is hovered or focused.
     *
     * If the tooltip is opened and `disabled` changes to true then we will immediately
     * hide the tooltip without animation.
     */
    isDisabled?: boolean;

    /**
     * Same as `isDisabled` but when we set this to `true` if a tooltip already exists
     * it will disappear immediately instead of animating out.
     */
    isDisabledWithoutAnimation?: boolean;

    /**
     * Where should the tooltip content be placed relative to the target element?
     * Defaults to `top`.
     */
    placement?: OverlayPlacement;

    /**
     * Placements to try if `placement` would put the overlay out of bounds. If it's an
     * empty array then the overlay will never flip from `placement`.
     *
     * If undefined the overlay can flip anywhere.
     *
     * Does not work with the special `center` placement.
     */
    fallbackPlacements?: ReadonlyArray<OverlayPlacement>;

    /**
     * Offset of the tooltip from the target.
     *
     * Defaults to `1.5`.
     */
    offset?: Spacing;

    /**
     * How far the tooltip should move along the reference.
     *
     * Defaults to `0`.
     */
    offsetAlong?: Spacing | `-${Spacing}`;

    /**
     * Maximum width of the tooltip content.
     *
     * Defaults to `64`. Most tooltip content is short so the default keeps tooltips
     * compact, but a wider maximum is useful when the content is long, like a tooltip
     * that shows the full text of a truncated line.
     */
    maxWidth?: Spacing;

    /**
     * Do we show the tooltip if our target is focused?
     *
     * Defaults to `true`.
     */
    isVisibleWhenFocused?: boolean;

    /**
     * Do we show the tooltip if a child has focus?
     *
     * If `isVisibleWhenFocused` is false then this prop has no effect.
     *
     * Defaults to `false`.
     */
    isVisibleWhenFocusWithin?: boolean;

    /**
     * Do we show the tooltip after the user has clicked the target?
     *
     * Defaults to `false` which hides the tooltip after a click.
     */
    isVisibleAfterPress?: boolean;

    /**
     * Is the target element considered to be hovered when the tooltip component
     * mounts? The mouse must move off the target element for the tooltip to disappear.
     *
     * Useful when using `targetElement` nad you've mounted this component after a
     * hover event.
     */
    isInitiallyHovered?: boolean;

    /**
     * The element our tooltip content will be rendered to point to. Must provide a ref
     * to an HTML element or we will throw an error.
     */
    children?: ReactElement | ((props: TooltipChildrenProps) => ReactElement);

    /**
     * The element our tooltip will be rendered to point to. Use this if your target
     * element is not managed by React. Otherwise prefer `children`. Can not provide
     * both `children` and `targetElement`.
     */
    targetElement?: HTMLElement;

    /**
     * Observe the tooltip's internal state.
     */
    onStateChange?: (state: TooltipState) => void;
};

export const defaultTooltipOffset: Spacing = "1.5";

/**
 * Renders some descriptive, non-interactive, information pointing to a target
 * element when a user is about to interact with that element.
 *
 * Only one tooltip across the entire application may be visible at a time.
 *
 * Avoid using this component for critical information as tooltips don't work for
 * our mobile site.
 */
function Tooltip(
    {
        content,
        isDisabled = false,
        isDisabledWithoutAnimation = false,
        placement = "top",
        fallbackPlacements,
        offset = defaultTooltipOffset,
        offsetAlong = "0",
        maxWidth,
        isVisibleWhenFocused = true,
        isVisibleWhenFocusWithin = false,
        isVisibleAfterPress = false,
        isInitiallyHovered = false,
        children: actualChildren,
        targetElement,
        onStateChange: _onStateChange,
    }: TooltipProps,
    ref: Ref<TooltipRef>,
) {
    const overlayRef = useRef<OverlayRef>(null);

    const isMounted = useIsMounted();
    const canPrimaryInputHover = useCanPrimaryInputHover();

    const tooltipId = useId();
    const tooltipRef = useRef<HTMLDivElement>(null);
    const tooltipContentRef = useRef<HTMLDivElement>(null);
    const tooltipSymbol = useConstant(() =>
        Symbol(`tooltip${tooltipId.startsWith(":") ? tooltipId : `:${tooltipId}`}`),
    );

    const activeTooltipSymbol = useContext(TooltipCoordinationActiveSymbolContext);
    const coordinationContext =
        useContext(TooltipCoordinationContext) ?? tooltipCoordinationContextForTest;
    assert(
        coordinationContext !== null,
        "Expected a parent `<TooltipCoordinationContextProvider>` component",
    );
    const {tooltipSymbolAboutToFadeOutRef, skipTooltipHoverDelay} = coordinationContext;

    useImperativeHandle(
        ref,
        () => ({
            forceUpdateTooltipPosition: () => {
                overlayRef.current?.forceUpdateOverlayPosition();
            },
            skipTooltipHoverDelay,
            skipTooltipHoverDelayAndAnimation: () => {
                setState(state => {
                    if (!state.isFadingIn) return state;
                    return {...state, isFadingIn: false};
                });

                skipTooltipHoverDelay();
            },
        }),
        [skipTooltipHoverDelay],
    );

    // Controls whether the tooltip is actually visible or not. Only one tooltip can be
    // visible on screen at once and that is managed by our tooltip coordination
    // context.
    const isVisible = !isDisabledWithoutAnimation && tooltipSymbol === activeTooltipSymbol;
    const hasActiveTooltipSymbol = activeTooltipSymbol !== null;
    const getHasActiveTooltipSymbol = useEvent(() => hasActiveTooltipSymbol);

    const [state, setState] = useState<TooltipState>(
        isInitiallyHovered && !isDisabled
            ? {
                  isHovered: true,
                  isFocused: false,
                  isFadingIn: true,
                  isFadingOut: false,
                  isDisabled,
                  hadHidingPointerDownWhileHovered: false,
              }
            : {
                  isHovered: false,
                  isFocused: false,
                  isFadingIn: false,
                  isFadingOut: false,
                  isDisabled,
                  hadHidingPointerDownWhileHovered: false,
              },
    );

    // When disabled prop changes, update our state. Importantly when we disable a
    // visible tooltip we want to fade it out.
    useEffect(() => {
        if (isDisabled) {
            setState((state): TooltipState => {
                if (state.isDisabled) return state;

                // When we disable a visible tooltip we want to fade it out.
                if (
                    (state.isHovered || state.isFocused) &&
                    !state.hadHidingPointerDownWhileHovered
                ) {
                    return {
                        ...state,
                        isFadingIn: false,
                        isFadingOut: !state.isFadingIn,
                        isDisabled: true,
                    };
                }

                return {
                    ...state,
                    isFadingIn: false,
                    isDisabled: true,
                };
            });
        } else {
            setState((state): TooltipState => {
                if (!state.isDisabled) return state;

                if (
                    (state.isHovered || state.isFocused) &&
                    !state.hadHidingPointerDownWhileHovered
                ) {
                    if (state.isFadingOut) {
                        return {
                            ...state,
                            isFadingOut: false,
                            isDisabled: false,
                        };
                    }
                    return {
                        ...state,
                        isFadingIn: true,
                        isDisabled: false,
                    };
                }

                return {
                    ...state,
                    isDisabled: false,
                };
            });
        }
    }, [isDisabled]);

    // Manage our tooltip symbol in the tooltip coordination context based on our
    // hover/focus state.
    useEffect(() => {
        if (
            (!state.isHovered && !state.isFocused) ||
            state.isDisabled ||
            state.hadHidingPointerDownWhileHovered
        ) {
            // We don't want to release our tooltip from the coordination context until both
            // its fade-in and fade-out animation have finished.
            if (!state.isFadingIn && !state.isFadingOut)
                coordinationContext.deleteHoveredAndDeleteFocusedTooltipSymbol(tooltipSymbol);
        } else if (!state.isHovered && state.isFocused) {
            coordinationContext.deleteHoveredAndAddFocusedTooltipSymbol(tooltipSymbol);
        } else if (state.isHovered && !state.isFocused) {
            coordinationContext.addHoveredAndDeleteFocusedTooltipSymbol(tooltipSymbol);
        } else if (state.isHovered && state.isFocused) {
            coordinationContext.addHoveredAndAddFocusedTooltipSymbol(tooltipSymbol);
        }
        return () => {
            if (!isMounted()) {
                coordinationContext.deleteHoveredAndDeleteFocusedTooltipSymbol(tooltipSymbol);
            }
        };
    }, [coordinationContext, isDisabled, isMounted, state, tooltipSymbol]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!state.isFadingIn || !isVisible) return;

        const tooltipContentElement = assertExists(tooltipContentRef.current);

        tooltipContentElement.classList.add(overlayAnimateFadeInClassName);

        const timeout = createTimeout(() => {
            setState(state => {
                if (!state.isFadingIn) {
                    return state;
                } else if (!state.isHovered && !state.isFocused) {
                    // If we are neither hovered nor focused then immediately transition to fading out.
                    return {
                        ...state,
                        isFadingIn: false,
                        isFadingOut: true,
                    };
                } else if (state.isHovered || state.isFocused) {
                    return {...state, isFadingIn: false};
                } else {
                    throw exhaustive(state);
                }
            });
        }, overlayFadeInAnimationDurationMs);

        return () => {
            tooltipContentElement.classList.remove(overlayAnimateFadeInClassName);
            timeout.clear();
        };
    }, [isVisible, state.isFadingIn]);

    const fadeOutAnimationRef = useRef<AnimationPlaybackControls | null>(null);

    // NOTE(calebmer, #mobile-webkit-weirdness): Implement fade out animation with the
    // `motion` package. I've observed CSS class based animations randomly stop working
    // on mobile WebKit after ~3min of app use. Implementing the animation with
    // `motion` fixes the issue. I have no idea why it fixes the issue, but it does.
    //
    // Adding `allowWebkitAcceleration: true` breaks the animation again. Interestingly
    // translation will work but the opacity change won't work.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!state.isFadingOut || !isVisible) {
            if (isVisible) {
                fadeOutAnimationRef.current?.cancel();
            } else {
                fadeOutAnimationRef.current?.complete();

                // If we aren't visible there is no animation happening, so don't wait.
                setState(state => {
                    if (!state.isFadingOut) {
                        return state;
                    } else {
                        return {...state, isFadingOut: false};
                    }
                });
            }
            fadeOutAnimationRef.current = null;
            return;
        }

        if (fadeOutAnimationRef.current !== null) {
            let isCancelled = false;

            void fadeOutAnimationRef.current.finished.finally(() => {
                if (isCancelled) return;
                fadeOutAnimationRef.current = null;
                setState(state => {
                    if (!state.isFadingOut) {
                        return state;
                    } else {
                        return {...state, isFadingOut: false};
                    }
                });
            });

            return () => {
                isCancelled = true;
            };
        }

        const tooltipElement = assertExists(tooltipRef.current);
        const tooltipContentElement = assertExists(tooltipContentRef.current);

        const popperPlacement = tooltipElement.dataset.popperPlacement;

        let animationKeyframes: {
            opacity: [number, number];
            x?: [string, string];
            y?: [string, string];
        };

        if (popperPlacement?.startsWith("top")) {
            animationKeyframes = {
                opacity: [1, 0],
                y: ["0rem", `-${spacing["1"]}`],
            };
        } else if (popperPlacement?.startsWith("bottom")) {
            animationKeyframes = {
                opacity: [1, 0],
                y: ["0rem", spacing["1"]],
            };
        } else if (popperPlacement?.startsWith("left")) {
            animationKeyframes = {
                opacity: [1, 0],
                x: ["0rem", `-${spacing["1"]}`],
            };
        } else if (popperPlacement?.startsWith("right")) {
            animationKeyframes = {
                opacity: [1, 0],
                x: ["0rem", spacing["1"]],
            };
        } else {
            // eslint-disable-next-line no-console
            console.warn(
                quote`Unexpected \`data-popper-placement\` attribute: ${popperPlacement ?? null}`,
            );

            const timeout = createTimeout(() => {
                setState(state => {
                    if (!state.isFadingOut) {
                        return state;
                    } else {
                        return {...state, isFadingOut: false};
                    }
                });
            }, overlayFadeOutAnimationDurationMs);

            return () => {
                timeout.clear();
            };
        }

        let isCancelled = false;

        // NOTE(calebmer): Without this `requestAnimationFrame()` the animation is [quite
        // choppy on iOS Safari][1]. I have no idea why adding this helps. My best guess is
        // the animation is being blocked by some JavaScript code?
        //
        // [1]: https://gist.github.com/calebmer/ab71d37aa8ebf3866043882ad17d32ca
        requestAnimationFrame(() => {
            if (isCancelled) return;

            fadeOutAnimationRef.current = animate(tooltipContentElement, animationKeyframes, {
                duration: overlayFadeOutAnimationDurationMs / 1000,
                ease: parseCubicBezier(overlayFadeInOutTimingFunction),
            });

            void fadeOutAnimationRef.current.finished.finally(() => {
                if (isCancelled) return;
                fadeOutAnimationRef.current = null;
                setState(state => {
                    if (!state.isFadingOut) {
                        return state;
                    } else {
                        return {...state, isFadingOut: false};
                    }
                });
            });
        });

        return () => {
            isCancelled = true;
        };
    }, [isVisible, state.isFadingOut]);

    const onStateChange = useEvent(_onStateChange);
    useEffect(() => {
        onStateChange(state);
    }, [onStateChange, state]);

    const isWaitingForOverlayPortalElement = useIsWaitingForOverlayPortalElement(isVisible);

    // Register event handlers on our target element that control our tooltip's state.
    const targetLifecycleRef = useCallback(
        (targetElement: HTMLElement) => {
            assert(
                targetElement instanceof HTMLElement,
                "Expected the children of a `<Tooltip>` component to render an element with a ref to an HTML element",
            );

            // If the overlay portal element is not ready then `tooltipRef` will not have
            // mounted yet even if `isVisible` is true.
            assert(!isVisible || isWaitingForOverlayPortalElement || tooltipRef.current);
            const tooltipElement = tooltipRef.current;

            function handleMouseEnter(event: MouseEvent) {
                // Ignore `mouseenter` events emulated by iOS.
                if (!canPrimaryInputHover) return;

                if (event.target !== targetElement) return;

                // If there is a visible tooltip that will fade out soon, cancel the fade out and
                // immediately show our tooltip.
                const isFadingIn = tooltipSymbolAboutToFadeOutRef.current === null;
                tooltipSymbolAboutToFadeOutRef.current?.immediatelyHide();
                tooltipSymbolAboutToFadeOutRef.current = null;

                setState((state): TooltipState => {
                    if (state.isHovered) {
                        return state;
                    } else if (!state.isHovered && !state.isFocused && !state.isDisabled) {
                        return {
                            ...state,
                            isHovered: true,
                            isFadingIn,
                            isFadingOut: false,
                            isDisabled: false,
                        };
                    } else if (state.isFocused || state.isDisabled) {
                        return {...state, isHovered: true};
                    } else {
                        throw exhaustive(state);
                    }
                });
            }

            function handleMouseLeave(event: MouseEvent) {
                // Ignore `mouseleave` events emulated by iOS.
                if (!canPrimaryInputHover) return;

                if (event.target !== targetElement) return;

                const updateState = ({isFadingOut}: {isFadingOut: boolean}) => {
                    setState((state): TooltipState => {
                        if (!state.isHovered) {
                            return state;
                        } else if (!state.isFocused) {
                            if (!isVisible) {
                                return {
                                    ...state,
                                    isHovered: false,
                                    isFadingIn: false,
                                    isFadingOut: false,
                                    hadHidingPointerDownWhileHovered: false,
                                };
                            } else if (!state.isFadingIn) {
                                return {
                                    ...state,
                                    isHovered: false,
                                    isFadingIn: false,
                                    isFadingOut,
                                    hadHidingPointerDownWhileHovered: false,
                                };
                            } else {
                                return {
                                    ...state,
                                    isHovered: false,
                                    hadHidingPointerDownWhileHovered: false,
                                };
                            }
                        } else if (state.isFocused) {
                            return {
                                ...state,
                                isHovered: false,
                                hadHidingPointerDownWhileHovered: false,
                            };
                        } else {
                            throw exhaustive(state);
                        }
                    });
                };

                // Record that we are going to fade out this tooltip soon. If another tooltip wants
                // to be visible before our timeout finishes we want to skip our animation.
                if (
                    getHasActiveTooltipSymbol() &&
                    tooltipSymbolAboutToFadeOutRef.current === null
                ) {
                    const timeout = createTimeout(() => {
                        updateState({isFadingOut: true});
                        tooltipSymbolAboutToFadeOutRef.current = null;
                    }, perceivedAsInstantLimitMs);

                    tooltipSymbolAboutToFadeOutRef.current = {
                        tooltipSymbol,
                        immediatelyHide: () => {
                            timeout.clear();
                            tooltipSymbolAboutToFadeOutRef.current = null;
                            updateState({isFadingOut: false});
                        },
                    };
                } else {
                    updateState({isFadingOut: true});
                }
            }

            // If the user clicks on the target, dismiss the tooltip without animation until
            // the mouse moves off the target element and back.
            function handlePointerDown() {
                if (isVisibleAfterPress) return;

                setState((state): TooltipState => {
                    if (!state.isHovered) {
                        return state;
                    } else {
                        return {
                            ...state,
                            isFadingIn: false,
                            isFadingOut: false,
                            hadHidingPointerDownWhileHovered: true,
                        };
                    }
                });
            }

            function handleFocusIn(event: FocusEvent) {
                if (!isVisibleWhenFocused) return;
                if (!isVisibleWhenFocusWithin && event.target !== targetElement) return;

                if (isFocusVisible()) {
                    // If there is a visible tooltip that will fade out soon, cancel the fade out and
                    // immediately show our tooltip.
                    const isFadingIn = tooltipSymbolAboutToFadeOutRef.current === null;
                    tooltipSymbolAboutToFadeOutRef.current?.immediatelyHide();
                    tooltipSymbolAboutToFadeOutRef.current = null;

                    setState((state): TooltipState => {
                        if (state.isFocused) {
                            return state;
                        } else if (!state.isHovered && !state.isFocused && !state.isDisabled) {
                            return {
                                ...state,
                                isFocused: true,
                                isFadingIn,
                                isFadingOut: false,
                            };
                        } else if (state.isHovered || state.isDisabled) {
                            return {...state, isFocused: true};
                        } else {
                            throw exhaustive(state);
                        }
                    });
                }
            }

            function handleFocusOut(event: FocusEvent) {
                if (!isVisibleWhenFocused) return;
                if (!isVisibleWhenFocusWithin && event.target !== targetElement) return;

                const updateState = ({isFadingOut}: {isFadingOut: boolean}) => {
                    setState(state => {
                        if (!state.isFocused) {
                            return state;
                        } else if (!state.isHovered) {
                            if (!isVisible) {
                                return {
                                    ...state,
                                    isFocused: false,
                                    isFadingIn: false,
                                    isFadingOut: false,
                                };
                            } else if (!state.isFadingIn) {
                                return {
                                    ...state,
                                    isFocused: false,
                                    isFadingIn: false,
                                    isFadingOut,
                                };
                            } else {
                                return {...state, isFocused: false};
                            }
                        } else if (state.isHovered) {
                            return {...state, isFocused: false};
                        } else {
                            throw exhaustive(state);
                        }
                    });
                };

                // Record that we are going to fade out this tooltip soon. If another tooltip wants
                // to be visible before our timeout finishes we want to skip our animation.
                //
                // For focus changes we only wait one animation frame to see if another tooltip
                // will pop in. Mouse movements are a little more imprecise.
                if (
                    getHasActiveTooltipSymbol() &&
                    tooltipSymbolAboutToFadeOutRef.current === null
                ) {
                    const animationFrameId = requestAnimationFrame(() => {
                        updateState({isFadingOut: true});
                        tooltipSymbolAboutToFadeOutRef.current = null;
                    });

                    tooltipSymbolAboutToFadeOutRef.current = {
                        tooltipSymbol,
                        immediatelyHide: () => {
                            cancelAnimationFrame(animationFrameId);
                            tooltipSymbolAboutToFadeOutRef.current = null;
                            updateState({isFadingOut: false});
                        },
                    };
                } else {
                    updateState({isFadingOut: true});
                }
            }

            const cleanupAttributes = setElementAttributesWithCleanup(targetElement, {
                "aria-describedby": tooltipElement?.getAttribute("id") ?? null,
            });

            targetElement.addEventListener("mouseenter", handleMouseEnter);
            targetElement.addEventListener("mouseleave", handleMouseLeave);
            targetElement.addEventListener("pointerdown", handlePointerDown, true);

            // We use `focusin`/`focusout` instead of `focus`/`blur` because the latter events
            // don't bubble.
            targetElement.addEventListener("focusin", handleFocusIn);
            targetElement.addEventListener("focusout", handleFocusOut);

            return () => {
                cleanupAttributes();

                targetElement.removeEventListener("mouseenter", handleMouseEnter);
                targetElement.removeEventListener("mouseleave", handleMouseLeave);
                targetElement.removeEventListener("pointerdown", handlePointerDown, true);
                targetElement.removeEventListener("focusin", handleFocusIn);
                targetElement.removeEventListener("focusout", handleFocusOut);
            };
        },
        // IMPORTANT: Be careful what you put in this dependency array. Other components
        // which wrap this one (like `<MenuButton>`) and modify the ref will need to rerun
        // whenever this ref changes.
        [
            isVisible,
            isWaitingForOverlayPortalElement,
            canPrimaryInputHover,
            tooltipSymbolAboutToFadeOutRef,
            getHasActiveTooltipSymbol,
            tooltipSymbol,
            isVisibleAfterPress,
            isVisibleWhenFocused,
            isVisibleWhenFocusWithin,
        ],
    );

    const children = useElementWithRef(
        useMemo(() => {
            if (typeof actualChildren !== "function") {
                return actualChildren;
            } else {
                return actualChildren({
                    isVisible,
                    skipHoverDelay: skipTooltipHoverDelay,
                });
            }
        }, [actualChildren, skipTooltipHoverDelay, isVisible]),
        useLifecycleRef(targetLifecycleRef),
    );

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!targetElement) return;
        return targetLifecycleRef(targetElement);
    }, [targetElement, targetLifecycleRef]);

    // Memoizing here because `TooltipCoordinationContext` forces us to re-render all
    // tooltips on the page whenever one tooltip is focused or hovered. We want to
    // minimize re-renders when that happens.
    //
    // Ideally, there would be a way for us to "select" state from
    // `TooltipCoordinationContext`. We only need to re-render a tooltip if we are
    // transitioning to being visible or away from being visible.
    return useMemo(() => {
        return (
            <Overlay
                ref={overlayRef}
                isVisible={isVisible}
                placement={placement}
                fallbackPlacements={fallbackPlacements}
                offset={offset}
                offsetAlong={offsetAlong}
                overlay={
                    <Box
                        ref={tooltipRef}
                        id={tooltipId}
                        role="tooltip"
                        pointerEvents="none"
                        className={overlayAnimateContainerClassName}
                    >
                        <TooltipContent ref={tooltipContentRef} maxWidth={maxWidth}>
                            {content}
                        </TooltipContent>
                    </Box>
                }
                children={children}
                targetElement={targetElement}
            />
        );
    }, [
        isVisible,
        placement,
        fallbackPlacements,
        offset,
        offsetAlong,
        maxWidth,
        tooltipId,
        content,
        children,
        targetElement,
    ]);
}

export function TooltipContent({
    ref,
    maxWidth = "64",
    children,
}: {
    ref?: Ref<HTMLDivElement>;
    maxWidth?: Spacing;
    children?: ReactNode;
}) {
    return (
        <Box
            ref={ref}
            maxWidth={maxWidth}
            paddingX="1.5"
            paddingY="1"
            fontSize="50"
            color="grey-100"
            backgroundColor="grey-0"
            borderRadius="0.5"
            boxShadow="elevation-20"
            pointerEvents="none"
            className={greyElevated2ClassName}
        >
            {children}
        </Box>
    );
}
