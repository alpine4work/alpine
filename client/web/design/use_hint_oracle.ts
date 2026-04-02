import {useEffect, useMemo, useRef, useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {createGlobalContext, useGlobalContext} from "~/client/web/helpers/global_context.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {falseStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

/**
 * All the different types of hints we may render in our app. These hint strings
 * are lexicographically sortable. If there are two competing hints rendering at
 * the same time then we pick the hint which sorts first.
 *
 * This is a type so it gets stripped away by TypeScript at build time so we don't
 * have a file containing an array with all the hint kinds strings across our
 * entire app. (The bundle size of which could be quite large.)
 *
 * A hint kind is formatted as `${OrderKey}#${HintName}`. The `OrderKey` allows us
 * to add hints in the middle of the list without having to renumber the existing
 * hints.
 */
export type HintKind =
    | "a0#ShareActivationHint"
    | "a1#SearchEducationHint"
    | "a2#TaskPeekStackAutoSaveHint";

// Double check that the syntax is `${OrderKey}#${HintName}`.
assertAssignableTypes<HintKind, `${string}#${string}`>();

class HintOracle {
    private readonly _stateStore = new ValueStore<{
        readonly activeHintSymbol: symbol | null;
        readonly hintKindBySymbol: ReadonlyMap<symbol, HintKind>;
    }>({
        activeHintSymbol: null,
        hintKindBySymbol: emptyMap,
    });

    private _isDecisionScheduled = false;

    public isActiveStore(symbol: symbol): Store<boolean> {
        return this._stateStore.map(state => state.activeHintSymbol === symbol);
    }

    public add(symbol: symbol, hintKind: HintKind): void {
        this._stateStore.set(oldState => {
            const newHintKindBySymbol = new Map(oldState.hintKindBySymbol);
            newHintKindBySymbol.set(symbol, hintKind);

            return {...oldState, hintKindBySymbol: newHintKindBySymbol};
        });

        // Schedule a decision to pick the active hint symbol. We wait for all hints to
        // mount and then we decide which one to make visible.
        this._scheduleDecision();
    }

    public delete(symbol: symbol): void {
        this._stateStore.set(oldState => {
            const newHintKindBySymbol = new Map(oldState.hintKindBySymbol);
            newHintKindBySymbol.delete(symbol);

            return {
                ...oldState,
                hintKindBySymbol: newHintKindBySymbol,

                // If the deleted symbol was the active hint then choose a new active hint.
                activeHintSymbol:
                    symbol === oldState.activeHintSymbol
                        ? decideActiveSymbol(newHintKindBySymbol)
                        : oldState.activeHintSymbol,
            };
        });
    }

    private _scheduleDecision() {
        // If there's already an active hint then the oracle won't pick a new one until
        // that hint has been deleted.
        if (this._stateStore.getSnapshot().activeHintSymbol !== null) return;

        if (this._isDecisionScheduled) return;
        this._isDecisionScheduled = true;

        setTimeout(() => {
            this._isDecisionScheduled = false;

            this._stateStore.set(oldState => {
                if (oldState.activeHintSymbol !== null) return oldState;

                return {
                    ...oldState,
                    activeHintSymbol: decideActiveSymbol(oldState.hintKindBySymbol),
                };
            });
        }, 1000);
    }
}

function decideActiveSymbol(hintKindBySymbol: ReadonlyMap<symbol, HintKind>): symbol | null {
    let active: {
        symbol: symbol;
        hintKind: HintKind;
    } | null = null;

    for (const [symbol, hintKind] of hintKindBySymbol) {
        if (active === null || hintKind < active.hintKind) {
            active = {symbol, hintKind};
        }
    }

    return active?.symbol ?? null;
}

const HintOracleContext = createGlobalContext(() => new HintOracle());

/**
 * Consult the hint oracle to determine whether it's ok to render our hint. We only
 * want to show one hint on screen at a time therefore some coordination is
 * required to decide which hint should get to render.
 *
 * If you want to render a hint, you pass in a `HintKind` string to this hook. The
 * oracle waits 1s for other React components to mount and then makes a decision on
 * which hint to show. The oracle picks the hint with the lowest `HintKind` value
 * when ordered lexicographically.
 *
 * We wait 1s since as long as we need to wait asynchronously for other React
 * components to mount we might as well make the delay look intentional to the
 * user. Also, the hint does a better job grabbing the user's attention if it pops
 * onscreen after the initial page load.
 */
export function useHintOracle(hintKind: HintKind | null): boolean {
    const context = useAppContext();
    const hintOracle = useGlobalContext(HintOracleContext);

    const [symbol] = useState<symbol>(() => Symbol());

    const isActive = useStore(
        useMemo(
            () => (hintKind !== null ? hintOracle.isActiveStore(symbol) : falseStore),
            [hintKind, hintOracle, symbol],
        ),
    );

    useEffect(() => {
        if (hintKind === null) return;

        hintOracle.add(symbol, hintKind);
        return () => {
            hintOracle.delete(symbol);
        };
    }, [hintOracle, symbol, hintKind]);

    const hasLoggedActiveHintRef = useRef(false);

    useEffect(() => {
        if (!isActive || hintKind === null) {
            hasLoggedActiveHintRef.current = false;
            return;
        }

        if (hasLoggedActiveHintRef.current) return;
        hasLoggedActiveHintRef.current = true;

        context.tracer.log(`Rendered hint ${assertExists(hintKind.split("#")[1])}`);
    }, [context.tracer, hintKind, isActive]);

    return isActive;
}
