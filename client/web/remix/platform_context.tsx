/* eslint-disable react-refresh/only-export-components */

import {ReactElement, ReactNode, createContext, useContext, useEffect, useState} from "react";
import {flushSync} from "react-dom";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {Platform, mobilePlatformMaxWindowWidth} from "~/shared/design/core/platform.open_source.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {ClientInfo} from "~/shared/remix/client_info.js";

const PlatformContext = createContext<Platform | null>(null);
const CanPrimaryInputHoverContext = createContext<boolean | null>(null);

/**
 * Get the current `Platform` the app is running in.
 */
export function usePlatform(): Platform {
    const platform = useContext(PlatformContext);

    if (platform === null) {
        // In unit tests, pretend like we are in desktop mode.
        if (import.meta.jest) return "desktop";

        throw new InternalError("Must be rendered in an `<PlatformContextProvider>`");
    }

    return platform;
}

/**
 * Can the user's primary input mechanism hover?
 *
 * Uses the CSS media query `(hover: none)`. When server rendering we use the same
 * value as `platform === "mobile"` then update on initial client render.
 */
export function useCanPrimaryInputHover(): boolean {
    const canPrimaryInputHover = useContext(CanPrimaryInputHoverContext);

    if (canPrimaryInputHover === null) {
        // In unit tests, pretend like we are not in mobile mode.
        if (import.meta.jest) return true;

        throw new InternalError("Must be rendered in an `<PlatformContextProvider>`");
    }

    return canPrimaryInputHover;
}

/**
 * Does this `ClientInfo` mean the initial app render will be considered to be a
 * mobile render? Whether we render in mobile mode is ultimately determined by the
 * window size but during a server render we only have the device's screen size in
 * our `ClientInfo` cookie.
 */
export function getInitialAppRenderPlatform(clientInfo: ClientInfo): Platform {
    return clientInfo.isNativeMobile || clientInfo.screenWidth <= mobilePlatformMaxWindowWidth
        ? "mobile"
        : "desktop";
}

/**
 * Get the current `Platform` for the app without listening for changes. Prefer
 * using `usePlatform()` so if the platform changes your component will re-render.
 */
export function getPlatformWithoutListening(): Platform {
    // The canonical platform is whatever is set in `data-platform`.
    const platform = document.documentElement.getAttribute("data-platform");
    if (platform !== null) return platform as Platform;

    return actuallyGetPlatformWithoutListening();
}

function actuallyGetPlatformWithoutListening(): Platform {
    return !!NativeMobileBridge || window.innerWidth <= mobilePlatformMaxWindowWidth
        ? "mobile"
        : "desktop";
}

let sharedMediaQueryListener: {
    mediaQuery: MediaQueryList;
    actualListener: () => void;
    listeners: Set<() => void>;
} | null = null;

/**
 * Subscribe to changes that might update `Platform`. To know for sure whether
 * `Platform` changed you must call `getPlatformWithoutListening()`. Generally you
 * should prefer using `usePlatform()` since it adds one window size listener for
 * the entire React component tree. But this function can be useful if you can't
 * use React for some reason.
 */
export function subscribeToPlatformChange(listener: () => void): () => void {
    // We use one shared event listener for changes to our media query so we can have
    // one React `flushSync()` transaction for all DOM updates that need to happen in
    // response to the platform changing.
    if (sharedMediaQueryListener === null) {
        const listeners = new Set<() => void>();

        const mediaQuery = window.matchMedia(
            `screen and (max-width: ${mobilePlatformMaxWindowWidth}px)`,
        );

        const actualListener = () => {
            // Disable all CSS transitions when we change the spacing scale. So anything with
            // `transition: width` or `transition: transform` (notably `<SwitchIcon>` and
            // `<ShareSwitchBase>`) change their size instantly instead of animating when the
            // spacing scale changes.
            const styleElement = document.createElement("style");
            styleElement.textContent = "*, *::before, *::after { transition: none !important }";
            document.head.appendChild(styleElement);

            flushSync(() => {
                for (const listener of listeners) {
                    try {
                        listener();
                    } catch (error) {
                        scheduleUncaughtError(error);
                    }
                }
            });

            // Wait for the browser to paint a frame before removing our CSS transition
            // override.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    styleElement.remove();
                });
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

let setPlatformOverride: ((platform: Platform | null) => void) | null = null;

/**
 * Override the platform. Make sure to clean up your platform override when you're
 * done. Currently this is just used for printing.
 */
export function overridePlatform(platform: Platform | null) {
    assertExists(setPlatformOverride)(platform);
}

export function usePlatformContextProvider(clientInfo: ClientInfo): {
    platform: Platform;
    render: (children: ReactNode) => ReactElement;
} {
    const [platform, setPlatform] = useState(getInitialAppRenderPlatform(clientInfo));

    const [platformOverride, actuallySetPlatformOverride] = useState<Platform | null>(null);

    useEffect(() => {
        const update = () => {
            setPlatform(actuallyGetPlatformWithoutListening());
        };

        const unsubscribe = subscribeToPlatformChange(update);

        // In case the value changed since the time component rendered.
        update();

        assert(!setPlatformOverride);
        setPlatformOverride = actuallySetPlatformOverride;

        return () => {
            unsubscribe();

            assert(setPlatformOverride === actuallySetPlatformOverride);
            setPlatformOverride = null;
        };
    }, []);

    const [canPrimaryInputHover, setCanPrimaryInputHover] = useState(platform !== "mobile");

    useEffect(() => {
        const mediaQuery = window.matchMedia("(hover: none)");

        const update = () => {
            setCanPrimaryInputHover(!mediaQuery.matches);
        };

        // In case the value changed since the time component rendered.
        update();

        mediaQuery.addEventListener("change", update);
        return () => {
            mediaQuery.removeEventListener("change", update);
        };
    }, []);

    return {
        platform: platformOverride ?? platform,
        render: (children: ReactNode) => (
            <PlatformContext.Provider value={platformOverride ?? platform}>
                <CanPrimaryInputHoverContext.Provider value={canPrimaryInputHover}>
                    {children}
                </CanPrimaryInputHoverContext.Provider>
            </PlatformContext.Provider>
        ),
    };
}

export function TestPlatformContextProvider({
    platform,
    children,
}: {
    platform: Platform;
    children?: ReactNode;
}) {
    // Can only use in tests
    assert(import.meta.jest);

    // Must not have a parent context provider
    assert(useContext(PlatformContext) === null);

    return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>;
}
