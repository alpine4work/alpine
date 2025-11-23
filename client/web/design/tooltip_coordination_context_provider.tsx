import {ReactNode, useEffect, useMemo, useRef, useState} from "react";
import {
    TooltipCoordinationActiveSymbolContext,
    TooltipCoordinationContext,
    TooltipCoordinationContextState,
    initialTooltipCoordinationContextState,
} from "~/client/web/design/internal/tooltip_coordination_context.js";
import {tooltipDelayMs} from "~/client/web/design/tooltip.js";

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
