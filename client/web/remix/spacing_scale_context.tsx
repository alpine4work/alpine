/* eslint-disable react-refresh/only-export-components */

import {ReactElement, ReactNode, createContext, useContext, useEffect, useState} from "react";
import {flushSync} from "react-dom";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {subscribeToPlatformChange} from "~/client/web/remix/platform_context.js";
import {mobilePlatformMaxWindowWidth} from "~/shared/design/core/platform.js";
import {
    SpacingScale,
    mediumSpacingScaleMinWindowWidth,
    remPxBySpacingScale,
} from "~/shared/design/core/spacing_scale.js";
import {InternalError} from "~/shared/error/error.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {ClientInfo} from "~/shared/remix/client_info.js";

const SpacingScaleContext = createContext<SpacingScale | null>(null);

/**
 * Get the current `SpacingScale` for the app.
 */
export function useSpacingScale(): SpacingScale {
    const spacingScale = useContext(SpacingScaleContext);

    if (spacingScale === null) {
        // In unit tests, pretend like we are in desktop mode.
        if (import.meta.jest) return "small";

        throw new InternalError("Must be rendered in an `<SpacingScaleContextProvider>`");
    }

    return spacingScale;
}

/**
 * What is the `SpacingScale` we use for the initial render based on our
 * `ClientInfo`? The `SpacingScale` is ultimately determined by the window size
 * but during a server render we only have the device's screen size in our
 * `ClientInfo` cookie.
 */
export function getInitialAppRenderSpacingScale(clientInfo: ClientInfo): SpacingScale {
    if (clientInfo.isNativeMobile) return "large";
    if (clientInfo.screenWidth <= mobilePlatformMaxWindowWidth) return "large";
    if (clientInfo.screenWidth >= mediumSpacingScaleMinWindowWidth) return "medium";
    return "small";
}

/**
 * Get the current `SpacingScale` for the app without listening for changes.
 * Prefer using `useSpacingScale()` so if the scale changes your component will
 * re-render.
 */
export function getSpacingScaleWithoutListening(): SpacingScale {
    if (NativeMobileBridge) return "large";
    if (window.innerWidth <= mobilePlatformMaxWindowWidth) return "large";
    if (window.innerWidth >= mediumSpacingScaleMinWindowWidth) return "medium";
    return "small";
}

/**
 * Get the current number of pixels in 1rem. Prefer `useRemPx()` so if the
 * screen size changes your component will re-render.
 */
export function getRemPxWithoutListening(): number {
    return remPxBySpacingScale[getSpacingScaleWithoutListening()];
}

let sharedMediaQueryListener: {
    mediaQuery: MediaQueryList;
    actualListener: () => void;
    listeners: Set<() => void>;
} | null = null;

/**
 * Subscribe to changes that might update `SpacingScale`. To know for sure
 * whether `SpacingScale` changed you must call
 * `getSpacingScaleWithoutListening()`. Generally you should prefer using
 * `useSpacingScale()` since it adds one window size listener for the entire
 * React component tree. But this function can be useful if you can't use React
 * for some reason.
 */
export function subscribeToSpacingScaleChange(listener: () => void): () => void {
    const unsubscribeFromPlatformChange = subscribeToPlatformChange(listener);

    // We use one shared event listener for changes to our media query so we can
    // have one React `flushSync()` transaction for all DOM updates that need to
    // happen in response to the spacing scale changing.
    if (sharedMediaQueryListener === null) {
        const listeners = new Set<() => void>();

        const mediaQuery = window.matchMedia(
            `screen and (min-width: ${mediumSpacingScaleMinWindowWidth}px)`,
        );

        const actualListener = () => {
            flushSync(() => {
                for (const listener of listeners) {
                    try {
                        listener();
                    } catch (error) {
                        scheduleUncaughtError(error);
                    }
                }
            });
        };

        mediaQuery.addEventListener("change", actualListener);

        sharedMediaQueryListener = {
            mediaQuery,
            actualListener,
            listeners,
        };
    }

    sharedMediaQueryListener.listeners.add(listener);

    return () => {
        unsubscribeFromPlatformChange();

        sharedMediaQueryListener?.listeners.delete(listener);

        if (sharedMediaQueryListener?.listeners.size === 0) {
            sharedMediaQueryListener.mediaQuery.removeEventListener(
                "change",
                sharedMediaQueryListener.actualListener,
            );
            sharedMediaQueryListener = null;
        }
    };
}

export function useSpacingScaleContextProvider(
    clientInfo: ClientInfo,
    children: ReactNode,
): {spacingScale: SpacingScale; children: ReactElement} {
    const [spacingScale, setSpacingScale] = useState(getInitialAppRenderSpacingScale(clientInfo));

    useEffect(() => {
        const update = () => {
            setSpacingScale(getSpacingScaleWithoutListening());
        };

        const unsubscribe = subscribeToSpacingScaleChange(update);

        // In case the value changed since the time component rendered.
        update();

        return unsubscribe;
    }, [clientInfo.isNativeMobile]);

    return {
        spacingScale,
        children: (
            <SpacingScaleContext.Provider value={spacingScale}>
                {children}
            </SpacingScaleContext.Provider>
        ),
    };
}
