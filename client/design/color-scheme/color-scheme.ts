import {scheduleException} from "~/shared/helpers/async/schedule-exception";
import {assert} from "~/shared/helpers/control/assert";

export type ColorScheme = "light" | "dark";

/**
 * Get the current color scheme without listening to future updates.
 */
export function getColorSchemeWithoutListening(): ColorScheme | null {
    if (typeof window === "undefined") return null;

    localStorage.getItem("colorScheme");

    const colorScheme = localStorage.getItem("colorScheme");
    const isDarkColorScheme =
        colorScheme === "dark" ||
        (!colorScheme && window.matchMedia("(prefers-color-scheme: dark)").matches);

    return isDarkColorScheme ? "dark" : "light";
}

const colorSchemeListeners = new Set<(colorScheme: ColorScheme) => void>();

function setColorScheme(colorScheme: ColorScheme) {
    assert(typeof window !== "undefined", "Can not set color scheme on the server");

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
    assert(typeof window !== "undefined", "Can not toggle color scheme on the server");

    const colorScheme = getColorSchemeWithoutListening();
    assert(colorScheme);

    setColorScheme(colorScheme === "dark" ? "light" : "dark");
}

/**
 * Fire a listener whenever the color scheme changes.
 */
export function listenToColorSchemeChanges(
    listener: (colorScheme: ColorScheme) => void,
): () => void {
    colorSchemeListeners.add(listener);
    return () => {
        colorSchemeListeners.delete(listener);
    };
}
