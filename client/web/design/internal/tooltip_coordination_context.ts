import {MutableRefObject, createContext, useContext, useEffect, useMemo} from "react";
import {UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {noop} from "~/shared/helpers/control/noop.js";

// We have a separate context for the active tooltip symbol because it updates
// frequently. Our second context, updates rarely.
export const TooltipCoordinationActiveSymbolContext = createContext<symbol | null>(null);

export type TooltipCoordinationContext = {
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

export const tooltipCoordinationContextForTest: TooltipCoordinationContext | null = import.meta.jest
    ? (() => {
          const unimplemented = (): never => {
              throw new UnimplementedError(
                  "`<Tooltip>` components don\u2019t respond to events in tests without a parent `<TooltipCoordinationContextProvider>` component",
              );
          };

          return {
              tooltipSymbolAboutToFadeOutRef: {current: null},
              addHoveredAndAddFocusedTooltipSymbol: unimplemented,
              addHoveredAndDeleteFocusedTooltipSymbol: unimplemented,
              deleteHoveredAndAddFocusedTooltipSymbol: unimplemented,
              // This is called unconditionally by `<Tooltip>` components. Given there's nothing
              // to delete in our test coordination context it's safe to noop.
              deleteHoveredAndDeleteFocusedTooltipSymbol: noop,
              addDisableTooltipSymbol: unimplemented,
              deleteDisableTooltipSymbol: unimplemented,
              skipTooltipHoverDelay: unimplemented,
          };
      })()
    : null;

export const TooltipCoordinationContext = createContext<TooltipCoordinationContext | null>(null);

export type TooltipCoordinationContextState = {
    readonly hoveredTooltipsStatus: "WarmingUp" | "WarmedUp" | "CooledDown";
    readonly hoveredTooltipSymbols: ReadonlySet<symbol>;
    readonly focusedTooltipSymbols: ReadonlySet<symbol>;
    readonly disableTooltipSymbols: ReadonlySet<symbol>;
};

export const initialTooltipCoordinationContextState: TooltipCoordinationContextState = {
    hoveredTooltipsStatus: "CooledDown",
    hoveredTooltipSymbols: new Set(),
    focusedTooltipSymbols: new Set(),
    disableTooltipSymbols: new Set(),
};

/**
 * While a component is rendered with this hook, we will make sure no tooltips may
 * be rendered.
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
