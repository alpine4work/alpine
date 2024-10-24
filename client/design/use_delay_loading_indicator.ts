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
export function useDelayLoadingIndicator(isLoading: boolean): boolean {
    const [originalShouldShowLoadingIndicator, setShouldShowLoadingIndicator] = useState(false);
    let shouldShowLoadingIndicator = originalShouldShowLoadingIndicator;

    if (isLoading === false && shouldShowLoadingIndicator === true) {
        shouldShowLoadingIndicator = false;
        setShouldShowLoadingIndicator(false);
    }

    useEffect(() => {
        if (isLoading === false) return;

        const timeout = createTimeout(() => {
            setShouldShowLoadingIndicator(true);
        }, delayLoadingIndicatorLimitMs);

        return () => {
            timeout.clear();
        };
    }, [isLoading]);

    return shouldShowLoadingIndicator;
}
