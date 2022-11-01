import {useEffect, useState} from "react";
import {scheduleException} from "~/shared/helpers/async/schedule-exception";
import {assert} from "~/shared/helpers/control/assert";

const initializeColorSchemeScript =
    'var colorScheme = localStorage.getItem("colorScheme"); var isDarkColorScheme = colorScheme === "dark" || !colorScheme && window.matchMedia("(prefers-color-scheme: dark)").matches; document.documentElement.dataset.colorScheme = isDarkColorScheme ? "dark" : "light";';

/**
 * A script that synchronously initializes the color scheme on the `<html>`
 * element. Should be placed in the `<head>` on all pages.
 *
 * This needs to be a synchronously executing script that blocks browser
 * rendering so that we don't render UI until the color scheme is initialized.
 *
 * If the user does not have an explicitly selected color scheme in local
 * storage then we initialize to their device preference.
 */
export function InitializeColorSchemeScript() {
    return <script dangerouslySetInnerHTML={{__html: initializeColorSchemeScript}} />;
}

export type ColorScheme = "light" | "dark";

/**
 * Get the current color scheme without listening to future updates.
 */
export function getColorSchemeWithoutListening(): ColorScheme | null {
    if (typeof document === "undefined") return null;
    return document.documentElement.dataset.colorScheme === "dark" ? "dark" : "light";
}

const colorSchemeListeners = new Set<(colorScheme: ColorScheme) => void>();

function setColorScheme(colorScheme: ColorScheme) {
    assert(typeof document !== "undefined", "Can not set color scheme on the server");

    document.documentElement.dataset.colorScheme = colorScheme;
    localStorage.setItem("colorScheme", colorScheme);

    for (const listener of colorSchemeListeners) {
        try {
            listener(colorScheme);
        } catch (error) {
            scheduleException(error);
        }
    }
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

    const colorScheme = getColorSchemeWithoutListening();
    assert(colorScheme);

    setColorScheme(colorScheme === "dark" ? "light" : "dark");
}

/**
 * Get the color scheme and re-render the component when the color
 * scheme changes.
 */
export function useColorScheme(): ColorScheme | null {
    const [colorScheme, setColorScheme] = useState<ColorScheme | null>(null);

    useEffect(() => {
        setColorScheme(getColorSchemeWithoutListening());

        colorSchemeListeners.add(setColorScheme);
        return () => {
            colorSchemeListeners.delete(setColorScheme);
        };
    }, []);

    return colorScheme;
}
