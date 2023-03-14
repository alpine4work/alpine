import {isFocusVisible} from "@react-aria/interactions";
import {
    MutableRefObject,
    ReactElement,
    ReactNode,
    Ref,
    createContext,
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
import {Box} from "~/client/design/box";
import {setElementAttributesWithCleanup} from "~/client/design/helpers/set_element_attributes_with_cleanup";
import {
    Overlay,
    OverlayPlacement,
    OverlayRef,
    useIsOverlayPortalElementReady,
} from "~/client/design/overlay";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants";
import {useConstant} from "~/client/helpers/lifecycle/use_constant";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {useIsMounted} from "~/client/helpers/lifecycle/use_is_mounted";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useElementWithRef} from "~/client/helpers/refs/use_element_with_ref";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref";
import {Spacing} from "~/shared/design/spacing";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {
    overlayAnimateContainerClassName,
    overlayAnimateFadeInClassName,
    overlayAnimateFadeOutClassName,
    overlayFadeInAnimationDurationMs,
    overlayFadeOutAnimationDurationMs,
} from "~/shared/styles/styles";

/**
 * Time it takes before we present a tooltip to the user if the user has
 * not taken another action.
 *
 * If the user hovers over a button for this amount of time, we present a
 * tooltip. If the user's mouse is quickly moving around then we don't present
 * a tooltip because the user is taking quick action and doesn't appear to need
 * extra context.
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
      }
    // Tooltip is disabled.
    | {
          readonly isHovered: false;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: true;
      }
    // Tooltip is fading in but we no longer have hover/focus so once the fade in
    // is done we will immediately transition to fading out.
    | {
          readonly isHovered: false;
          readonly isFocused: false;
          readonly isFadingIn: true;
          readonly isFadingOut: false;
          readonly isDisabled: false;
      }
    // Tooltip is fading out.
    | {
          readonly isHovered: false;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: true;
          readonly isDisabled: false;
      }
    // Tooltip is fading out and disabled.
    | {
          readonly isHovered: false;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: true;
          readonly isDisabled: true;
      }
    // Tooltip is hovered.
    | {
          readonly isHovered: true;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: false;
      }
    // Tooltip is focused.
    | {
          readonly isHovered: false;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: false;
      }
    // Tooltip is hovered and focused.
    | {
          readonly isHovered: true;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: false;
      }
    // Tooltip is hovered and disabled.
    | {
          readonly isHovered: true;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: true;
      }
    // Tooltip is focused and disabled.
    | {
          readonly isHovered: false;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: true;
      }
    // Tooltip is hovered and focused and disabled.
    | {
          readonly isHovered: true;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
          readonly isDisabled: true;
      }
    // Tooltip is hovered and fading in.
    | {
          readonly isHovered: true;
          readonly isFocused: false;
          readonly isFadingIn: true;
          readonly isFadingOut: false;
          readonly isDisabled: false;
      }
    // Tooltip is focused and fading in.
    | {
          readonly isHovered: false;
          readonly isFocused: true;
          readonly isFadingIn: true;
          readonly isFadingOut: false;
          readonly isDisabled: false;
      }
    // Tooltip is hovered and focused and fading in.
    | {
          readonly isHovered: true;
          readonly isFocused: true;
          readonly isFadingIn: true;
          readonly isFadingOut: false;
          readonly isDisabled: false;
      }
    // Tooltip is hovered and fading out.
    // Can only fade out while hovered when disabled.
    | {
          readonly isHovered: true;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: true;
          readonly isDisabled: true;
      }
    // Tooltip is focused and fading out.
    // Can only fade out while focused when disabled.
    | {
          readonly isHovered: false;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: true;
          readonly isDisabled: true;
      }
    // Tooltip is hovered and focused and fading out.
    // Can only fade out while hovered and focused when disabled.
    | {
          readonly isHovered: true;
          readonly isFocused: true;
          readonly isFadingIn: false;
          readonly isFadingOut: true;
          readonly isDisabled: true;
      };

type TooltipChildrenProps = {
    /**
     * Is the tooltip currently visible? True even when the tooltip is fading in
     * and out of visibility.
     */
    isVisible: boolean;

    /**
     * When hovering over a tooltip, we have a delay before the tooltip becomes
     * visible to make sure the user's mouse wasn't quickly moving over the
     * tooltip. Calling this function skips that delay.
     */
    skipHoverDelay: () => void;
};

export type TooltipRef = {
    /**
     * Force the tooltip to update its position.
     */
    forceUpdateTooltipPosition(): void;
};

const TooltipForwardRef = forwardRef(Tooltip);
export {TooltipForwardRef as Tooltip};

export type TooltipProps = {
    /**
     * The contents of the tooltip. We expect this to be text most of the time.
     */
    content: ReactNode;

    /**
     * If true the tooltip won't open even if the target element is hovered or
     * focused.
     *
     * If the tooltip is opened and `disabled` changes to true then we will
     * immediately hide the tooltip without animation.
     */
    isDisabled?: boolean;

    /**
     * Same as `isDisabled` but when we set this to `true` if a tooltip already
     * exists it will disappear immediately instead of animating out.
     */
    isDisabledWithoutAnimation?: boolean;

    /**
     * Where should the tooltip content be placed relative to the target element?
     * Defaults to `top`.
     */
    placement?: OverlayPlacement;

    /**
     * If true, changes the `placement` of a popper to make sure it stays visible
     * within the nearest parent `<OverlayScopeContextProvider>`.
     *
     * Defaults to `true`.
     */
    canFlip?: boolean;

    /**
     * Offset of the tooltip from the target.
     *
     * Defaults to `1.5`.
     */
    offset?: Spacing;

    /**
     * Do we show the tooltip if a child has focus?
     *
     * Defaults to `false`.
     */
    visibleWhenFocusWithin?: boolean;

    /**
     * The element our tooltip content will be rendered to point to. Must provide
     * a ref to an HTML element or we will throw an error.
     */
    children?: ReactElement | ((props: TooltipChildrenProps) => ReactElement);

    /**
     * The element our tooltip will be rendered to point to. Use this if your
     * target element is not managed by React. Otherwise prefer `children`. Can not
     * provide both `children` and `targetElement`.
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
 * Avoid using this component for critical information as tooltips don't work
 * for our mobile site.
 */
function Tooltip(
    {
        content,
        isDisabled = false,
        isDisabledWithoutAnimation = false,
        placement = "top",
        canFlip = true,
        offset = defaultTooltipOffset,
        visibleWhenFocusWithin = false,
        children: actualChildren,
        targetElement,
        onStateChange: _onStateChange,
    }: TooltipProps,
    ref: Ref<TooltipRef>,
) {
    const overlayRef = useRef<OverlayRef>(null);

    useImperativeHandle(
        ref,
        () => ({
            forceUpdateTooltipPosition: () => {
                overlayRef.current?.forceUpdateOverlayPosition();
            },
        }),
        [],
    );

    const isMounted = useIsMounted();
    const isOverlayPortalElementReady = useIsOverlayPortalElementReady();

    const tooltipId = useId();
    const tooltipRef = useRef<HTMLDivElement>(null);
    const tooltipSymbol = useConstant(() =>
        Symbol(`tooltip${tooltipId.startsWith(":") ? tooltipId : `:${tooltipId}`}`),
    );

    const activeTooltipSymbol = useContext(TooltipCoordinationActiveSymbolContext);
    const coordinationContext = useContext(TooltipCoordinationContext);
    assert(
        coordinationContext !== null,
        "Expected a parent `<TooltipCoordinationContextProvider>` component",
    );
    const {tooltipSymbolAboutToFadeOutRef} = coordinationContext;

    // Controls whether the tooltip is actually visible or not. Only one tooltip
    // can be visible on screen at once and that is managed by our tooltip
    // coordination context.
    const isVisible = !isDisabledWithoutAnimation && tooltipSymbol === activeTooltipSymbol;
    const hasActiveTooltipSymbol = activeTooltipSymbol !== null;
    const getHasActiveTooltipSymbol = useEvent(() => hasActiveTooltipSymbol);

    const [state, setState] = useState<TooltipState>({
        isHovered: false,
        isFocused: false,
        isFadingIn: false,
        isFadingOut: false,
        isDisabled,
    });

    // When disabled prop changes, update our state. Importantly when we disable a
    // visible tooltip we want to fade it out.
    useEffect(() => {
        if (isDisabled) {
            setState((state): TooltipState => {
                if (state.isDisabled) return state;

                // When we disable a visible tooltip we want to fade it out.
                if (state.isHovered || state.isFocused) {
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

                if (state.isHovered || state.isFocused) {
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
        if ((!state.isHovered && !state.isFocused) || state.isDisabled) {
            // We don't want to release our tooltip from the coordination context
            // until both its fade-in and fade-out animation have finished.
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

    // If we are fading in then setup a timeout to update our state when the
    // animation ends.
    useEffect(() => {
        if (state.isFadingIn) {
            if (isVisible) {
                const timeout = createTimeout(() => {
                    setState(state => {
                        if (!state.isFadingIn) {
                            return state;
                        } else if (!state.isHovered && !state.isFocused) {
                            // If we are neither hovered nor focused then immediately transition
                            // to fading out.
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
                    timeout.clear();
                };
            } else {
                // If we aren't visible then we're waiting to see if our coordination
                // context tells us we are the only visible tooltip.
            }
        }
    }, [state.isFadingIn, isVisible]);

    // If we are fading out then setup a timeout to update our state when the
    // animation ends.
    useEffect(() => {
        if (state.isFadingOut) {
            if (isVisible) {
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
            } else {
                // If we aren't visible there is no animation happening, so don't wait.
                setState(state => ({...state, isFadingOut: false}));
            }
        }
    }, [state.isFadingOut, isVisible]);

    const onStateChange = useEvent(_onStateChange);
    useEffect(() => {
        onStateChange(state);
    }, [onStateChange, state]);

    // Register event handlers on our target element that control our tooltip's
    // state.
    const targetLifecycleRef = useCallback(
        (targetElement: HTMLElement) => {
            assert(
                targetElement instanceof HTMLElement,
                "Expected the children of a `<Tooltip>` component to render an element with a ref to an HTML element",
            );

            // If the overlay portal element is not ready then `tooltipRef` will not have
            // mounted yet.
            assert(!isVisible || !isOverlayPortalElementReady || tooltipRef.current);
            const tooltipElement = tooltipRef.current;

            function handleMouseEnter(event: MouseEvent) {
                if (event.target !== targetElement) return;

                // If there is a visible tooltip that will fade out soon, cancel the fade out
                // and immediately show our tooltip.
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
                if (event.target !== targetElement) return;

                const updateState = ({isFadingOut}: {isFadingOut: boolean}) => {
                    setState(state => {
                        if (!state.isHovered) {
                            return state;
                        } else if (!state.isFocused) {
                            if (!isVisible) {
                                return {
                                    ...state,
                                    isHovered: false,
                                    isFadingIn: false,
                                    isFadingOut: false,
                                };
                            } else if (!state.isFadingIn) {
                                return {
                                    ...state,
                                    isHovered: false,
                                    isFadingIn: false,
                                    isFadingOut,
                                };
                            } else {
                                return {...state, isHovered: false};
                            }
                        } else if (state.isFocused) {
                            return {...state, isHovered: false};
                        } else {
                            throw exhaustive(state);
                        }
                    });
                };

                // Record that we are going to fade out this tooltip soon. If another tooltip
                // wants to be visible before our timeout finishes we want to skip our
                // animation.
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

            function handleFocusIn(event: FocusEvent) {
                if (!visibleWhenFocusWithin && event.target !== targetElement) return;

                if (isFocusVisible()) {
                    // If there is a visible tooltip that will fade out soon, cancel the fade out
                    // and immediately show our tooltip.
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
                if (!visibleWhenFocusWithin && event.target !== targetElement) return;

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

                // Record that we are going to fade out this tooltip soon. If another tooltip
                // wants to be visible before our timeout finishes we want to skip our
                // animation.
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

            // We use `focusin`/`focusout` instead of `focus`/`blur` because the latter
            // events don't bubble.
            targetElement.addEventListener("focusin", handleFocusIn);
            targetElement.addEventListener("focusout", handleFocusOut);

            return () => {
                cleanupAttributes();

                targetElement.removeEventListener("mouseenter", handleMouseEnter);
                targetElement.removeEventListener("mouseleave", handleMouseLeave);
                targetElement.removeEventListener("focusin", handleFocusIn);
                targetElement.removeEventListener("focusout", handleFocusOut);
            };
        },
        // IMPORTANT: Be careful what you put in this dependency array. Other
        // components which wrap this one (like `<MenuButton>`) and modify the ref will
        // need to rerun whenever this ref changes.
        [
            isVisible,
            isOverlayPortalElementReady,
            tooltipSymbolAboutToFadeOutRef,
            getHasActiveTooltipSymbol,
            tooltipSymbol,
            visibleWhenFocusWithin,
        ],
    );

    const children = useElementWithRef(
        useMemo(() => {
            if (typeof actualChildren !== "function") {
                return actualChildren;
            } else {
                return actualChildren({
                    isVisible,
                    skipHoverDelay: coordinationContext.skipTooltipHoverDelay,
                });
            }
        }, [actualChildren, coordinationContext.skipTooltipHoverDelay, isVisible]),
        useLifecycleRef(targetLifecycleRef),
    );

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!targetElement) return;
        return targetLifecycleRef(targetElement);
    }, [targetElement, targetLifecycleRef]);

    // Memoizing here because `TooltipCoordinationContext` forces us to re-render
    // all tooltips on the page whenever one tooltip is focused or hovered. We
    // want to minimize re-renders when that happens.
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
                canFlip={canFlip}
                offset={offset}
                overlay={
                    <Box
                        ref={tooltipRef}
                        id={tooltipId}
                        role="tooltip"
                        pointerEvents="none"
                        className={overlayAnimateContainerClassName}
                    >
                        <Box
                            paddingX="1.5"
                            paddingY="0.5"
                            fontSize="50"
                            color="grey-text"
                            backgroundColor={{light: "grey-0", dark: "grey-5"}}
                            borderRadius="sm"
                            boxShadow="elevation-20"
                            className={
                                state.isFadingOut
                                    ? overlayAnimateFadeOutClassName
                                    : state.isFadingIn
                                    ? overlayAnimateFadeInClassName
                                    : undefined
                            }
                        >
                            {content}
                        </Box>
                    </Box>
                }
                children={children}
                targetElement={targetElement}
            />
        );
    }, [
        isVisible,
        placement,
        canFlip,
        offset,
        tooltipId,
        state.isFadingOut,
        state.isFadingIn,
        content,
        children,
        targetElement,
    ]);
}

/**
 * While a component is rendered with this hook, we will make sure no tooltips
 * may be rendered.
 */
export function useShouldDisableTooltips(shouldDisableTooltips: boolean = true) {
    const tooltipSymbol = useMemo(() => Symbol(), []);

    const coordinationContext = useContext(TooltipCoordinationContext);
    assert(coordinationContext !== null);

    useEffect(() => {
        if (shouldDisableTooltips) {
            coordinationContext.addDisableTooltipSymbol(tooltipSymbol);
            return () => {
                coordinationContext.deleteDisableTooltipSymbol(tooltipSymbol);
            };
        }
    }, [coordinationContext, shouldDisableTooltips, tooltipSymbol]);
}

// We have a separate context for the active tooltip symbol because it updates
// frequently. Our second context, updates rarely.
const TooltipCoordinationActiveSymbolContext = createContext<symbol | null>(null);

type TooltipCoordinationContext = {
    readonly tooltipSymbolAboutToFadeOutRef: MutableRefObject<{
        readonly tooltipSymbol: symbol;
        readonly immediatelyHide: () => void;
    } | null>;
    readonly addHoveredAndAddFocusedTooltipSymbol: (symbol: symbol) => void;
    readonly addHoveredAndDeleteFocusedTooltipSymbol: (symbol: symbol) => void;
    readonly deleteHoveredAndAddFocusedTooltipSymbol: (symbol: symbol) => void;
    readonly deleteHoveredAndDeleteFocusedTooltipSymbol: (symbol: symbol) => void;
    readonly addDisableTooltipSymbol: (symbol: symbol) => void;
    readonly deleteDisableTooltipSymbol: (symbol: symbol) => void;
    readonly skipTooltipHoverDelay: () => void;
};

const TooltipCoordinationContext = createContext<TooltipCoordinationContext | null>(null);

type TooltipCoordinationContextState = {
    readonly hoveredTooltipsStatus: "WarmingUp" | "WarmedUp" | "CooledDown";
    readonly hoveredTooltipSymbols: ReadonlySet<symbol>;
    readonly focusedTooltipSymbols: ReadonlySet<symbol>;
    readonly disableTooltipSymbols: ReadonlySet<symbol>;
};

const initialTooltipCoordinationContextState: TooltipCoordinationContextState = {
    hoveredTooltipsStatus: "CooledDown",
    hoveredTooltipSymbols: new Set(),
    focusedTooltipSymbols: new Set(),
    disableTooltipSymbols: new Set(),
};

/**
 * Coordinates any tooltips rendered under this context so that only one tooltip
 * is visible at once.
 */
export function TooltipCoordinationContextProvider({children}: {children: ReactNode}) {
    const [state, setState] = useState<TooltipCoordinationContextState>(
        initialTooltipCoordinationContextState,
    );

    // Discover the one currently active tooltip across the application.
    let activeTooltipSymbol: symbol | null = null;

    // Don't allow there to be an active symbol if we have some disable tooltip
    // symbols.
    if (!(state.disableTooltipSymbols.size > 0)) {
        // Focused tooltips take precedence over hovered tooltips.
        if (activeTooltipSymbol === null) {
            for (const tooltipSymbol of state.focusedTooltipSymbols) {
                activeTooltipSymbol = tooltipSymbol;
                break;
            }
        }

        // Hovered tooltips can only be active after tooltip hovering has been
        // warmed up.
        if (activeTooltipSymbol === null && state.hoveredTooltipsStatus === "WarmedUp") {
            for (const tooltipSymbol of state.hoveredTooltipSymbols) {
                activeTooltipSymbol = tooltipSymbol;
                break;
            }
        }
    }

    const hasActiveTooltipSymbol = activeTooltipSymbol !== null;

    const hasHoveredTooltipSymbols =
        !(state.disableTooltipSymbols.size > 0) && state.hoveredTooltipSymbols.size > 0;

    // If our state transitioned to `WarmingUp` let's run our warm up timeout and
    // switch the state to `WarmedUp`. We don't show tooltips while we are
    // warming up.
    useEffect(() => {
        if (state.hoveredTooltipsStatus === "WarmingUp" && hasHoveredTooltipSymbols) {
            const timeoutId = setTimeout(() => {
                setState(oldState => {
                    return {
                        ...oldState,
                        hoveredTooltipsStatus: "WarmedUp",
                    };
                });
            }, tooltipDelayMs);

            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [hasHoveredTooltipSymbols, state.hoveredTooltipsStatus]);

    // If we're warmed up, but there's no longer an active tooltip we want to
    // transition back to our cooled down state after a timeout.
    //
    // This is a separate effect because it has an extra dependency.
    useEffect(() => {
        if (state.hoveredTooltipsStatus === "WarmedUp" && !hasActiveTooltipSymbol) {
            const timeoutId = setTimeout(() => {
                setState(oldState => {
                    return {
                        ...oldState,
                        hoveredTooltipsStatus: "CooledDown",
                    };
                });
            }, 1000);

            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [hasActiveTooltipSymbol, state.hoveredTooltipsStatus]);

    const tooltipSymbolAboutToFadeOutRef = useRef<{
        readonly tooltipSymbol: symbol;
        readonly immediatelyHide: () => void;
    } | null>(null);

    const context = useMemo((): TooltipCoordinationContext => {
        const addHoveredTooltipSymbolUpdater = (
            state: TooltipCoordinationContextState,
            tooltipSymbol: symbol,
        ): TooltipCoordinationContextState => {
            if (state.hoveredTooltipSymbols.has(tooltipSymbol)) return state;

            const hoveredTooltipSymbols = new Set(state.hoveredTooltipSymbols);
            hoveredTooltipSymbols.add(tooltipSymbol);

            return {
                ...state,
                hoveredTooltipSymbols,
                hoveredTooltipsStatus:
                    state.hoveredTooltipsStatus !== "WarmedUp"
                        ? "WarmingUp"
                        : state.hoveredTooltipsStatus,
            };
        };

        const addFocusedTooltipSymbolUpdater = (
            state: TooltipCoordinationContextState,
            tooltipSymbol: symbol,
        ): TooltipCoordinationContextState => {
            if (state.focusedTooltipSymbols.has(tooltipSymbol)) return state;

            const focusedTooltipSymbols = new Set(state.focusedTooltipSymbols);
            focusedTooltipSymbols.add(tooltipSymbol);

            return {...state, focusedTooltipSymbols};
        };

        const deleteHoveredTooltipSymbolUpdater = (
            state: TooltipCoordinationContextState,
            tooltipSymbol: symbol,
        ): TooltipCoordinationContextState => {
            if (!state.hoveredTooltipSymbols.has(tooltipSymbol)) return state;

            const hoveredTooltipSymbols = new Set(state.hoveredTooltipSymbols);
            hoveredTooltipSymbols.delete(tooltipSymbol);

            return {...state, hoveredTooltipSymbols};
        };

        const deleteFocusedTooltipSymbolUpdater = (
            state: TooltipCoordinationContextState,
            tooltipSymbol: symbol,
        ): TooltipCoordinationContextState => {
            if (!state.focusedTooltipSymbols.has(tooltipSymbol)) return state;

            const focusedTooltipSymbols = new Set(state.focusedTooltipSymbols);
            focusedTooltipSymbols.delete(tooltipSymbol);

            return {...state, focusedTooltipSymbols};
        };

        return {
            tooltipSymbolAboutToFadeOutRef,
            addHoveredAndAddFocusedTooltipSymbol: tooltipSymbol => {
                setState(state => {
                    state = addHoveredTooltipSymbolUpdater(state, tooltipSymbol);
                    state = addFocusedTooltipSymbolUpdater(state, tooltipSymbol);
                    return state;
                });
            },
            addHoveredAndDeleteFocusedTooltipSymbol: tooltipSymbol => {
                setState(state => {
                    state = addHoveredTooltipSymbolUpdater(state, tooltipSymbol);
                    state = deleteFocusedTooltipSymbolUpdater(state, tooltipSymbol);
                    return state;
                });
            },
            deleteHoveredAndAddFocusedTooltipSymbol: tooltipSymbol => {
                setState(state => {
                    state = deleteHoveredTooltipSymbolUpdater(state, tooltipSymbol);
                    state = addFocusedTooltipSymbolUpdater(state, tooltipSymbol);
                    return state;
                });
            },
            deleteHoveredAndDeleteFocusedTooltipSymbol: tooltipSymbol => {
                setState(state => {
                    state = deleteHoveredTooltipSymbolUpdater(state, tooltipSymbol);
                    state = deleteFocusedTooltipSymbolUpdater(state, tooltipSymbol);
                    return state;
                });
            },
            addDisableTooltipSymbol: tooltipSymbol => {
                setState(state => {
                    if (state.disableTooltipSymbols.has(tooltipSymbol)) return state;

                    const disableTooltipSymbols = new Set(state.disableTooltipSymbols);
                    disableTooltipSymbols.add(tooltipSymbol);

                    return {...state, disableTooltipSymbols};
                });
            },
            deleteDisableTooltipSymbol: tooltipSymbol => {
                setState(state => {
                    if (!state.disableTooltipSymbols.has(tooltipSymbol)) return state;

                    const disableTooltipSymbols = new Set(state.disableTooltipSymbols);
                    disableTooltipSymbols.delete(tooltipSymbol);

                    return {...state, disableTooltipSymbols};
                });
            },
            skipTooltipHoverDelay: () => {
                setState(state => {
                    if (state.hoveredTooltipsStatus === "WarmingUp") {
                        return {...state, hoveredTooltipsStatus: "WarmedUp"};
                    } else {
                        return state;
                    }
                });
            },
        };
    }, []);

    return (
        <TooltipCoordinationContext.Provider value={context}>
            <TooltipCoordinationActiveSymbolContext.Provider value={activeTooltipSymbol}>
                {children}
            </TooltipCoordinationActiveSymbolContext.Provider>
        </TooltipCoordinationContext.Provider>
    );
}
