import {useEffect, useState} from "react";
import {flushSync} from "react-dom";
import {colorSchemeEventEmitter} from "~/client/helpers/internal/color_scheme_event_emitter.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/initial_app_render.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";

export type ColorScheme = "light" | "dark";

/**
 * Get the current color scheme without listening to future updates if we are
 * executing in a browser client.
 */
export function getColorSchemeWithoutListeningIfBrowser(): ColorScheme | null {
    if (typeof document === "undefined") return null;
    return document.documentElement.getAttribute("data-color") === "dark" ? "dark" : "light";
}

const colorSchemeListeners = new Set<(colorScheme: ColorScheme) => void>();

export function setColorScheme(colorScheme: ColorScheme) {
    assert(typeof document !== "undefined", "Can not set color scheme on the server");

    document.documentElement.setAttribute("data-color", colorScheme);
    localStorage.setItem("colorScheme", colorScheme);

    // Make sure React re-renders synchronously when the color scheme changes. That
    // way we don't get UI tearing where non-React code has new colors (thanks to
    // CSS) but React code has old colors.
    flushSync(() => {
        for (const listener of colorSchemeListeners) {
            try {
                listener(colorScheme);
            } catch (error) {
                scheduleUncaughtError(error);
            }
        }
    });
}

export function subscribeToColorSchemeChange(listener: (colorScheme: ColorScheme) => void) {
    return colorSchemeEventEmitter.subscribe(listener);
}

/**
 * Switch the color scheme. If the color scheme is light, we switch to dark. If
 * the color scheme is dark, we switch to light.
 *
 * Calling this function once means we will no longer inherit the system
 * setting.
 */
export function toggleColorScheme() {
    assert(typeof document !== "undefined", "Can not toggle color scheme on the server");

    const colorScheme = getColorSchemeWithoutListeningIfBrowser();
    assert(colorScheme);

    setColorScheme(colorScheme === "dark" ? "light" : "dark");
}

/**
 * Get the color scheme and re-render the component when the color
 * scheme changes.
 *
 * Will return null when rendering on the server.
 */
export function useColorScheme(): ColorScheme | null {
    const isInitialAppRender = useIsInitialAppRender();
    const [colorScheme, setColorScheme] = useState<ColorScheme | null>(
        isInitialAppRender ? null : getColorSchemeWithoutListeningIfBrowser(),
    );

    useEffect(() => {
        setColorScheme(getColorSchemeWithoutListeningIfBrowser());

        colorSchemeListeners.add(setColorScheme);
        return () => {
            colorSchemeListeners.delete(setColorScheme);
        };
    }, []);

    return colorScheme;
}
