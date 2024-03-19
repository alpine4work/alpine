import {useEffect, useState} from "react";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";

const initializeColorSchemeScript =
    'var colorScheme = localStorage.getItem("colorScheme"); var isDarkColorScheme = colorScheme === "dark" || !colorScheme && window.matchMedia("(prefers-color-scheme: dark)").matches; document.documentElement.dataset.colorScheme = isDarkColorScheme ? "dark" : "light";';

/**
 * Manages the color scheme for the page. Importantly, contains a script that
 * synchronously initializes the color scheme on the `<html>` element. Should
 * be placed in the `<head>` on all pages.
 *
 * The script needs to be a synchronously executing script that blocks browser
 * rendering so that we don't render UI until the color scheme is initialized.
 *
 * If the user does not have an explicitly selected color scheme in local
 * storage then we initialize to their device preference.
 *
 * Also subscribes to device color scheme preference changes. So we can
 * re-render in light/dark mode when the user changes their configuration.
 * Useful if the device is configured to be dark mode at night and light mode
 * during the day.
 */
export function ColorSchemeManager() {
    useEffect(() => {
        const darkColorSchemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

        const update = () => {
            const colorSchemeString = localStorage.getItem("colorScheme");

            const isDarkColorScheme =
                colorSchemeString === "dark" ||
                (!colorSchemeString && darkColorSchemeMediaQuery.matches);

            const colorScheme = isDarkColorScheme ? "dark" : "light";

            if (colorScheme !== document.documentElement.dataset.colorScheme) {
                document.documentElement.dataset.colorScheme = colorScheme;

                for (const listener of colorSchemeListeners) {
                    try {
                        listener(colorScheme);
                    } catch (error) {
                        scheduleUncaughtError(error);
                    }
                }
            }
        };

        darkColorSchemeMediaQuery.addEventListener("change", update);
        return () => {
            darkColorSchemeMediaQuery.removeEventListener("change", update);
        };
    }, []);

    return <script dangerouslySetInnerHTML={{__html: initializeColorSchemeScript}} />;
}

export type ColorScheme = "light" | "dark";

/**
 * Get the current color scheme without listening to future updates if we are
 * executing in a browser client.
 */
export function getColorSchemeWithoutListeningIfBrowser(): ColorScheme | null {
    if (typeof document === "undefined") return null;
    return document.documentElement.dataset.colorScheme === "dark" ? "dark" : "light";
}

const colorSchemeListeners = new Set<(colorScheme: ColorScheme) => void>();

export function setColorScheme(colorScheme: ColorScheme) {
    assert(typeof document !== "undefined", "Can not set color scheme on the server");

    document.documentElement.dataset.colorScheme = colorScheme;
    localStorage.setItem("colorScheme", colorScheme);

    for (const listener of colorSchemeListeners) {
        try {
            listener(colorScheme);
        } catch (error) {
            scheduleUncaughtError(error);
        }
    }
}

export function subscribeToColorSchemeChange(listener: (colorScheme: ColorScheme) => void) {
    colorSchemeListeners.add(listener);
    return () => {
        colorSchemeListeners.delete(listener);
    };
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
