import {SpinnerGap} from "phosphor-react";
import {ReactNode, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {useDevConsoleTool} from "~/client/web/helpers/dev_console.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {
    GlobalLoadingIndicator,
    mergeGlobalLoadingIndicators,
    mergeManyGlobalLoadingIndicators,
} from "~/client/web/spaces/global_loading_indicator_types.js";
import {GlobalLoadingIndicatorContext} from "~/client/web/spaces/internal/global_loading_indicator_context.js";
import {spinAnimationClassName} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

let nextGlobalLoadingIndicatorId = 1;

type GlobalLoadingIndicatorState = {
    readonly mergedIndicator: GlobalLoadingIndicator | null;
    readonly clearMergedIndicatorTime: number | null;
    readonly indicators: ReadonlyArray<{
        readonly id: number;
        readonly promise: Promise<unknown>;
        readonly startTime: number;
        readonly indicator: GlobalLoadingIndicator;
    }>;
};

const initialGlobalLoadingIndicatorState: GlobalLoadingIndicatorState = {
    mergedIndicator: null,
    clearMergedIndicatorTime: null,
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
        if (indicatorState.clearMergedIndicatorTime === null) return;

        const timeout = createTimeout(() => {
            setIndicatorState(indicatorState => ({
                mergedIndicator: mergeManyGlobalLoadingIndicators(
                    mapIterable(indicatorState.indicators, ({indicator}) => indicator),
                ),
                clearMergedIndicatorTime: null,
                indicators: indicatorState.indicators,
            }));
        }, indicatorState.clearMergedIndicatorTime - Date.now());

        return () => {
            timeout.clear();
        };
    }, [indicatorState.clearMergedIndicatorTime]);

    const add = useCallback((promise: Promise<unknown>, indicator: GlobalLoadingIndicator) => {
        const id = nextGlobalLoadingIndicatorId;
        nextGlobalLoadingIndicatorId++;

        const startTime = Date.now();

        setIndicatorState(indicatorState => ({
            mergedIndicator:
                indicatorState.mergedIndicator !== null
                    ? mergeGlobalLoadingIndicators(indicatorState.mergedIndicator, indicator)
                    : indicator,
            clearMergedIndicatorTime: indicatorState.clearMergedIndicatorTime,
            indicators: [...indicatorState.indicators, {id, promise, startTime, indicator}],
        }));

        const remove = () => {
            const endTime = Date.now();

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
                    clearMergedIndicatorTime:
                        indicatorState.clearMergedIndicatorTime ??
                        endTime + delayLoadingIndicatorLimitMs,
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

    const minIndicatorStartTime = useMemo(() => {
        let minIndicatorStartTime = null;

        for (const indicator of indicatorState.indicators) {
            if (minIndicatorStartTime === null || indicator.startTime < minIndicatorStartTime) {
                minIndicatorStartTime = indicator.startTime;
            }
        }

        return minIndicatorStartTime;
    }, [indicatorState.indicators]);

    const hasSavingIndicator = indicator !== null && indicator.type !== "Loading";
    const hasSavingIndicatorRef = useRef(hasSavingIndicator);
    const savingIndicatorPromiseResolverRefs = useRef<Array<PromiseResolver<void>> | null>(null);

    useDevConsoleTool("globalLoadingIndicator", () => ({
        waitForSavingIndicator: () => {
            if (!hasSavingIndicatorRef.current) return Promise.resolve();

            const promiseResolver = createPromiseResolver();
            savingIndicatorPromiseResolverRefs.current ??= [];
            savingIndicatorPromiseResolverRefs.current.push(promiseResolver);
            return promiseResolver.promise;
        },
    }));

    // Warn the user if they try to leave Alpine while there are still some changes
    // to which are saving.
    useEffect(() => {
        hasSavingIndicatorRef.current = hasSavingIndicator;

        if (!hasSavingIndicator) return;

        const handleBeforeUnload = (event: BeforeUnloadEvent) => {
            const confirmationMessage = "Changes you made may not be saved.";
            event.returnValue = confirmationMessage;
            return confirmationMessage;
        };

        window.addEventListener("beforeunload", handleBeforeUnload);
        return () => {
            window.removeEventListener("beforeunload", handleBeforeUnload);

            if (savingIndicatorPromiseResolverRefs.current !== null) {
                for (const promiseResolver of savingIndicatorPromiseResolverRefs.current) {
                    promiseResolver.resolve();
                }
                savingIndicatorPromiseResolverRefs.current = null;
            }
        };
    }, [hasSavingIndicator]);

    const hasIndicator = indicator !== null;

    // `shouldShowIndicator` is true if we're more than
    // `delayLoadingIndicatorLimitMs` from the oldest indicator
    // (determined by `minIndicatorStartTime`). Once the oldest indicator
    // completes, we set `shouldShowIndicator` to false if the remaining indicators
    // are younger than `delayLoadingIndicatorLimitMs`.
    //
    // This way if a user is continuously typing and an individual update while
    // they're typing takes a while we'll show the indicator just for that update
    // and then the update disappears if the subsequent updates are fast.
    //
    // This code is similar to `useDelayLoadingIndicator()`.
    let shouldShowIndicator = false;
    {
        const [originalShouldShowIndicator, setShouldShowIndicator] = useState(false);
        shouldShowIndicator = originalShouldShowIndicator;

        if (hasIndicator === false && shouldShowIndicator === true) {
            shouldShowIndicator = false;
            setShouldShowIndicator(false);
        }

        useEffect(() => {
            if (hasIndicator === false) return;

            // The assert is fine since if `hasIndicator` is true then
            // `minIndicatorStartTime` should be non-null since there's at least one
            // indicator.
            const timeoutMs =
                assertExists(minIndicatorStartTime) + delayLoadingIndicatorLimitMs - Date.now();

            if (timeoutMs <= 0) {
                setShouldShowIndicator(true);
                return;
            }

            setShouldShowIndicator(false);

            const timeout = createTimeout(() => {
                setShouldShowIndicator(true);
            }, timeoutMs);

            return () => {
                timeout.clear();
            };
        }, [hasIndicator, minIndicatorStartTime]);
    }

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

    const progress = useStore(
        indicator.type === "Uploading" ? (indicator.progressStore ?? null) : null,
    );

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
                          Math.round(progress * 100),
                          // We never want to show 100%. The most we'll show is 99%. 100% means done. As
                          // long as the loading indicator is visible, clearly we're not done.
                          99,
                      )}%)`
                    : null}
            </Box>
        </Box>
    );
}
