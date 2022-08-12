import classNames from "classnames";
import {
    ReactElement,
    ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/design/box";
import {setElementAttributesWithCleanup} from "~/client/design/helpers/set-element-attributes-with-cleanup";
import {useElementWithRef} from "~/client/design/helpers/use-element-with-ref";
import {useLifecycleRef} from "~/client/design/helpers/use-lifecycle-ref";
import {Overlay, OverlayPlacement} from "~/client/design/overlay";
import {uninterruptedThoughtLimitMs} from "~/client/design/timing-constants";
import {
    tooltipAnimateFadeInClassName,
    tooltipAnimateFadeOutClassName,
    tooltipArrowClassName,
    tooltipArrowSvgClassName,
    tooltipClassName,
    tooltipFadeAnimationDurationMs,
} from "~/client/design/tooltip.css";
import {useIsMounted} from "~/client/helpers/lifecycle/use-is-mounted";
import {sprinkles} from "~/shared/design/sprinkles.css";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule-microtask";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";

type TooltipState =
    // Tooltip is definitely not visible.
    | {
          readonly isHovered: false;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: false;
      }
    // Tooltip is fading in but we no longer have hover/focus so once the fade in
    // is done we will immediately transition to fading out.
    | {
          readonly isHovered: false;
          readonly isFocused: false;
          readonly isFadingIn: true;
          readonly isFadingOut: false;
      }
    // Tooltip is fading out.
    | {
          readonly isHovered: false;
          readonly isFocused: false;
          readonly isFadingIn: false;
          readonly isFadingOut: true;
      }
    // Tooltip is hovered and possibly fading in.
    | {
          readonly isHovered: true;
          readonly isFocused: false;
          readonly isFadingIn: boolean;
          readonly isFadingOut: false;
      }
    // Tooltip is focused and possibly fading in.
    | {
          readonly isHovered: false;
          readonly isFocused: true;
          readonly isFadingIn: boolean;
          readonly isFadingOut: false;
      }
    // Tooltip is hovered and focused and possibly fading in.
    | {
          readonly isHovered: true;
          readonly isFocused: true;
          readonly isFadingIn: boolean;
          readonly isFadingOut: false;
      };

const initialTooltipState: TooltipState = {
    isHovered: false,
    isFocused: false,
    isFadingIn: false,
    isFadingOut: false,
};

type TooltipChildrenProps = {
    /**
     * Is the tooltip currently visible? True even when the tooltip is fading in
     * and out of visibility.
     */
    isVisible: boolean;

    /**
     * When hovering over a tooltip, we have a delay before the tooltip becomes
     * visible to make sure the user’s mouse wasn’t quickly moving over the
     * tooltip. Calling this function skips that delay.
     */
    skipHoverDelay: () => void;
};

/**
 * Renders some descriptive, non-interactive, information pointing to a target
 * element when a user is about to interact with that element.
 *
 * Only one tooltip across the entire application may be visible at a time.
 *
 * Avoid using this component for critical information as tooltips don’t work
 * for our mobile site.
 */
export function Tooltip({
    content,
    placement = "top",
    children: actualChildren,
}: {
    /**
     * The contents of the tooltip. We expect this to be text most of the time.
     */
    content: ReactNode;

    /**
     * Where should the tooltip content be placed relative to the target element?
     * Defaults to `top`.
     */
    placement?: OverlayPlacement;

    /**
     * The element our tooltip content will be rendered to point to. Must provide
     * a ref to an HTML element or we will throw an error.
     */
    children: ReactElement | ((props: TooltipChildrenProps) => ReactElement);
}) {
    const isMounted = useIsMounted();

    const tooltipId = useId();
    const tooltipRef = useRef<HTMLDivElement>(null);
    const tooltipSymbol = useMemo(() => Symbol(), []);

    const activeTooltipSymbol = useContext(TooltipCoordinationActiveSymbolContext);
    const coordinationContext = useContext(TooltipCoordinationContext);
    assert(coordinationContext !== null);

    // Controls whether the tooltip is actually visible or not. Only one tooltip
    // can be visible on screen at once and that is managed by our tooltip
    // coordination context.
    const visible = tooltipSymbol === activeTooltipSymbol;

    const [state, setState] = useState<TooltipState>(initialTooltipState);

    // Manage our tooltip symbol in the tooltip coordination context based on our
    // hover/focus state.
    useEffect(() => {
        if (!state.isHovered && !state.isFocused) {
            // We don’t want to release our tooltip from the coordination context
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
    }, [coordinationContext, isMounted, state, tooltipSymbol]);

    // If we are fading in then setup a timeout to update our state when the
    // animation ends.
    useEffect(() => {
        if (state.isFadingIn) {
            if (visible) {
                const timeoutId = setTimeout(() => {
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
                }, tooltipFadeAnimationDurationMs);

                return () => {
                    clearTimeout(timeoutId);
                };
            } else {
                // If we aren’t visible then we’re waiting to see if our coordination
                // context tells us we are the only visible tooltip.
            }
        }
    }, [state.isFadingIn, visible]);

    // If we are fading out then setup a timeout to update our state when the
    // animation ends.
    useEffect(() => {
        if (state.isFadingOut) {
            if (visible) {
                const timeoutId = setTimeout(() => {
                    setState(state => {
                        if (!state.isFadingOut) {
                            return state;
                        } else {
                            return {...state, isFadingOut: false};
                        }
                    });
                }, tooltipFadeAnimationDurationMs);

                return () => {
                    clearTimeout(timeoutId);
                };
            } else {
                // If we aren’t visible there is no animation happening, so don’t wait.
                setState(state => ({...state, isFadingOut: false}));
            }
        }
    }, [state.isFadingOut, visible]);

    // Register event handlers on our target element that control our tooltip’s
    // state.
    const targetLifecycleRef = useCallback(
        (targetElement: HTMLElement) => {
            assert(
                targetElement instanceof HTMLElement,
                "Expected the children of `<Tooltip>` to render an element with a ref to an HTML element",
            );

            assert(!visible || tooltipRef.current);
            const tooltipElement = tooltipRef.current;

            function handleMouseEnter(event: MouseEvent) {
                if (event.target !== targetElement) return;

                setState(state => {
                    if (state.isHovered) {
                        return state;
                    } else if (!state.isHovered && !state.isFocused) {
                        return {
                            ...state,
                            isHovered: true,
                            isFadingIn: true,
                            isFadingOut: false,
                        };
                    } else if (state.isFocused) {
                        return {...state, isHovered: true};
                    } else {
                        throw exhaustive(state);
                    }
                });
            }

            function handleMouseLeave(event: MouseEvent) {
                if (event.target !== targetElement) return;

                setState(state => {
                    if (!state.isHovered) {
                        return state;
                    } else if (!state.isFocused) {
                        if (!visible) {
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
                                isFadingOut: true,
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
            }

            function handleFocus(event: FocusEvent) {
                if (event.target !== targetElement) return;

                // This depends on the `focus-visible` JS polyfill being installed on
                // the page. Even if the `:focus-visible` pseudo-class is supported in
                // the browser.
                //
                // Wait a microtask for the `focus-visible` polyfill to run. If this
                // focus is a result of a keyboard interaction (vs a mouse interaction)
                // then the focus visible class will have been added to the element.
                scheduleMicrotask(() => {
                    if (targetElement.hasAttribute("data-focus-visible")) {
                        setState(state => {
                            if (state.isFocused) {
                                return state;
                            } else if (!state.isHovered && !state.isFocused) {
                                return {
                                    ...state,
                                    isFocused: true,
                                    isFadingIn: true,
                                    isFadingOut: false,
                                };
                            } else if (state.isHovered) {
                                return {...state, isFocused: true};
                            } else {
                                throw exhaustive(state);
                            }
                        });
                    }
                });
            }

            function handleBlur(event: FocusEvent) {
                if (event.target !== targetElement) return;

                setState(state => {
                    if (!state.isFocused) {
                        return state;
                    } else if (!state.isHovered) {
                        if (!visible) {
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
                                isFadingOut: true,
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
            }

            const cleanupAttributes = setElementAttributesWithCleanup(targetElement, {
                "aria-describedby": tooltipElement?.getAttribute("id") ?? null,
            });

            targetElement.addEventListener("mouseenter", handleMouseEnter);
            targetElement.addEventListener("mouseleave", handleMouseLeave);
            targetElement.addEventListener("focus", handleFocus);
            targetElement.addEventListener("blur", handleBlur);

            return () => {
                cleanupAttributes();

                targetElement.removeEventListener("mouseenter", handleMouseEnter);
                targetElement.removeEventListener("mouseleave", handleMouseLeave);
                targetElement.removeEventListener("focus", handleFocus);
                targetElement.removeEventListener("blur", handleBlur);
            };
        },
        [visible],
    );

    const children = useElementWithRef(
        useMemo(() => {
            if (typeof actualChildren !== "function") {
                return actualChildren;
            } else {
                return actualChildren({
                    isVisible: visible,
                    skipHoverDelay: coordinationContext.skipTooltipHoverDelay,
                });
            }
        }, [actualChildren, coordinationContext.skipTooltipHoverDelay, visible]),
        useLifecycleRef(targetLifecycleRef),
    );

    // TODO(calebmer): Tweak tooltip styles when we know the elevation system

    // Memoizing here because `TooltipCoordinationContext` forces us to re-render
    // all tooltips on the page whenever one tooltip is focused or hovered. We
    // want to minimize re-renders when that happens.
    //
    // Ideally, there would be a way for us to “select” state from
    // `TooltipCoordinationContext`. We only need to re-render a tooltip if we are
    // transitioning to being visible or away from being visible.
    return useMemo(() => {
        return (
            <Overlay
                visible={visible}
                placement={placement}
                overlay={
                    <div
                        ref={tooltipRef}
                        id={tooltipId}
                        role="tooltip"
                        className={tooltipClassName}
                    >
                        <div
                            className={
                                state.isFadingOut
                                    ? tooltipAnimateFadeOutClassName
                                    : tooltipAnimateFadeInClassName
                            }
                        >
                            <Box
                                paddingX="1"
                                paddingY="0"
                                font="sm"
                                color="grey-100"
                                backgroundColor="grey-10"
                                borderRadius="base"
                            >
                                {content}
                            </Box>
                            <div
                                className={tooltipArrowClassName}
                                style={{position: "absolute"}}
                                data-popper-arrow
                            >
                                <svg
                                    className={classNames(
                                        tooltipArrowSvgClassName,
                                        sprinkles({
                                            width: "2",
                                            height: "2",
                                            color: "grey-10",
                                        }),
                                    )}
                                    fill="currentColor"
                                    viewBox="0 0 600 600"
                                >
                                    <polygon points="300,80 600,600 0,600" />
                                </svg>
                            </div>
                        </div>
                    </div>
                }
            >
                {children}
            </Overlay>
        );
    }, [visible, placement, tooltipId, state.isFadingOut, content, children]);
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

    // Don’t allow there to be an active symbol if we have some disable tooltip
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

    // If our state transitioned to `WarmingUp` let’s run our warm up timeout and
    // switch the state to `WarmedUp`. We don’t show tooltips while we are
    // warming up.
    useEffect(() => {
        if (state.hoveredTooltipsStatus === "WarmingUp" && hasHoveredTooltipSymbols) {
            const timeoutID = setTimeout(() => {
                setState(oldState => {
                    return {
                        ...oldState,
                        hoveredTooltipsStatus: "WarmedUp",
                    };
                });
            }, uninterruptedThoughtLimitMs);

            return () => {
                clearTimeout(timeoutID);
            };
        }
    }, [hasHoveredTooltipSymbols, state.hoveredTooltipsStatus]);

    // If we’re warmed up, but there’s no longer an active tooltip we want to
    // transition back to our cooled down state after a timeout.
    //
    // This is a separate effect because it has an extra dependency.
    useEffect(() => {
        if (state.hoveredTooltipsStatus === "WarmedUp" && !hasActiveTooltipSymbol) {
            const timeoutID = setTimeout(() => {
                setState(oldState => {
                    return {
                        ...oldState,
                        hoveredTooltipsStatus: "CooledDown",
                    };
                });
            }, uninterruptedThoughtLimitMs);

            return () => {
                clearTimeout(timeoutID);
            };
        }
    }, [hasActiveTooltipSymbol, state.hoveredTooltipsStatus]);

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
