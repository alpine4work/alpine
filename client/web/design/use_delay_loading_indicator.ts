import {useEffect, useState} from "react";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";

/**
 * To improve the user experience, we avoid showing a loading indicator until a
 * fraction of a second after loading actually begins. That way, if the network
 * request is fast we show no spinner and the user perceives the action as
 * happening instantly.
 *
 * This hook returns true `delayLoadingIndicatorLimitMs` after `isLoading` is
 * set to true so you can delay presenting a loading indicator.
 */
export function useDelayLoadingIndicator(
    isLoading: boolean,
    delayMs: number = delayLoadingIndicatorLimitMs,
): boolean {
    const [originalLoadingIndicator, setLoadingIndicator] = useState<{
        isShowing: boolean;
        showTime: number;
    } | null>(null);
    let loadingIndicator = originalLoadingIndicator;

    if (isLoading === false && loadingIndicator !== null) {
        loadingIndicator = null;
        setLoadingIndicator(null);
    }

    if (isLoading === true && loadingIndicator === null) {
        loadingIndicator = {isShowing: false, showTime: Date.now() + delayMs};
        setLoadingIndicator(loadingIndicator);
    }

    useEffect(() => {
        if (loadingIndicator?.showTime === undefined) return;

        const timeout = createTimeout(() => {
            setLoadingIndicator(loadingIndicator => {
                if (!loadingIndicator) return null;
                return {...loadingIndicator, isShowing: true};
            });
        }, loadingIndicator.showTime - Date.now());

        return () => {
            timeout.clear();
        };
    }, [loadingIndicator?.showTime]);

    return loadingIndicator !== null && loadingIndicator.isShowing === true;
}
