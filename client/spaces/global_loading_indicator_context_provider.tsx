import {SpinnerGap} from "phosphor-react";
import {ReactNode, useCallback, useEffect, useMemo, useState} from "react";
import {Box} from "~/client/design/box.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useStore} from "~/client/helpers/use_store.js";
import {
    GlobalLoadingIndicator,
    mergeGlobalLoadingIndicators,
    mergeManyGlobalLoadingIndicators,
} from "~/client/spaces/global_loading_indicator_types.js";
import {GlobalLoadingIndicatorContext} from "~/client/spaces/internal/global_loading_indicator_context.js";
import {spinAnimationClassName} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

let nextGlobalLoadingIndicatorId = 1;

type GlobalLoadingIndicatorState = {
    readonly mergedIndicator: GlobalLoadingIndicator | null;
    readonly replaceMergedIndicatorTime: number | null;
    readonly indicators: ReadonlyArray<{
        readonly id: number;
        readonly promise: Promise<unknown>;
        readonly indicator: GlobalLoadingIndicator;
    }>;
};

const initialGlobalLoadingIndicatorState: GlobalLoadingIndicatorState = {
    mergedIndicator: null,
    replaceMergedIndicatorTime: null,
    indicators: emptyArray,
};

export function GlobalLoadingIndicatorContextProvider({
    children,
}: {
    children: (indicator: GlobalLoadingIndicator | null) => ReactNode;
}) {
    const [indicatorState, setIndicatorState] = useState<GlobalLoadingIndicatorState>(
        initialGlobalLoadingIndicatorState,
    );

    useEffect(() => {
        if (indicatorState.replaceMergedIndicatorTime === null) return;

        const timeout = createTimeout(() => {
            setIndicatorState(indicatorState => ({
                mergedIndicator: mergeManyGlobalLoadingIndicators(
                    mapIterable(indicatorState.indicators, ({indicator}) => indicator),
                ),
                replaceMergedIndicatorTime: null,
                indicators: indicatorState.indicators,
            }));
        }, indicatorState.replaceMergedIndicatorTime - Date.now());

        return () => {
            timeout.clear();
        };
    }, [indicatorState.replaceMergedIndicatorTime]);

    const add = useCallback((promise: Promise<unknown>, indicator: GlobalLoadingIndicator) => {
        const id = nextGlobalLoadingIndicatorId;
        nextGlobalLoadingIndicatorId++;

        setIndicatorState(indicatorState => ({
            mergedIndicator:
                indicatorState.mergedIndicator !== null
                    ? mergeGlobalLoadingIndicators(indicatorState.mergedIndicator, indicator)
                    : indicator,
            replaceMergedIndicatorTime: indicatorState.replaceMergedIndicatorTime,
            indicators: [...indicatorState.indicators, {id, promise, indicator}],
        }));

        const remove = () => {
            const currentTime = Date.now();

            setIndicatorState(indicatorState => {
                const newIndicators = indicatorState.indicators.filter(
                    otherIndicator => otherIndicator.id !== id,
                );

                if (newIndicators.length === 0) return initialGlobalLoadingIndicatorState;

                return {
                    mergedIndicator: indicatorState.mergedIndicator,
                    // If we're removing a loading indicator while we still have more loading
                    // indicators then wait a bit before replacing the old loading indicator. This
                    // is for cases like file upload. First we have an "Uploading" indicator which
                    // is followed by a short "Saving" indicator. Instead of flashing the "Saving"
                    // indicator we'd like to keep showing the "Uploading" indicator until saving
                    // completes.
                    replaceMergedIndicatorTime:
                        indicatorState.replaceMergedIndicatorTime ??
                        currentTime + delayLoadingIndicatorLimitMs,
                    indicators: newIndicators,
                };
            });
        };

        // Ignore any errors from this promise so we don't get uncaught promise
        // rejections. It's expected that the caller of this function will deal with
        // rejections from the provided promise.
        promise.then(remove, remove);
    }, []);

    const indicator = indicatorState.mergedIndicator;

    const hasNonLoadingIndicator = indicator !== null && indicator.type !== "Loading";

    // Warn the user if they try to leave Alpine while there are still some changes
    // to which are saving.
    useEffect(() => {
        if (!hasNonLoadingIndicator) return;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            const confirmationMessage = "Changes you made may not be saved.";
            event.returnValue = confirmationMessage;
            return confirmationMessage;
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);
        };
    }, [hasNonLoadingIndicator]);

    const shouldShowIndicator = useDelayLoadingIndicator(indicator !== null);
    const delayedIndicator = shouldShowIndicator ? indicator : null;

    return (
        <GlobalLoadingIndicatorContext.Provider value={useMemo(() => ({add}), [add])}>
            {children(delayedIndicator)}
        </GlobalLoadingIndicatorContext.Provider>
    );
}

export const globalLoadingIndicatorChipHeight = "7";

export function GlobalLoadingIndicatorChip({indicator}: {indicator: GlobalLoadingIndicator}) {
    let indicatorText: string;

    switch (indicator.type) {
        case "Loading":
            indicatorText = "Loading";
            break;
        case "Saving":
            indicatorText = "Saving";
            break;
        case "Pasting":
            indicatorText = "Pasting";
            break;
        case "Uploading":
            indicatorText = "Uploading";
            break;
        default:
            throw exhaustive(indicator);
    }

    const progress = useStore(indicator.type === "Uploading" ? indicator.progressStore : null);

    return (
        <Box
            height={globalLoadingIndicatorChipHeight}
            paddingX="2"
            color="grey-40"
            fontSize="75"
            display="flex"
            alignItems="center"
            gap="1"
            style={{fontVariantNumeric: "tabular-nums"}}
        >
            <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
            <Box>
                {indicatorText}
                {progress !== null
                    ? ` (${clamp(
                          0,
                          // We never want to show 100%. The most we'll show is 99%. 100% means done. As
                          // long as the loading indicator is visible, clearly we're not done.
                          Math.round(progress * 99),
                          99,
                      )}%)`
                    : null}
            </Box>
        </Box>
    );
}
