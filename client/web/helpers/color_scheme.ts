import {useEffect, useState} from "react";
import {colorSchemeEventEmitter} from "~/client/web/helpers/internal/color_scheme_event_emitter.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
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

/**
 * Get whether the color scheme was set by the system preference.
 */
function getIsSystemPreferenceIfBrowser(): boolean | null {
    if (typeof localStorage === "undefined") return null;
    return !localStorage.getItem("colorScheme");
}

export function setColorScheme(colorScheme: ColorScheme | "system") {
    assert(typeof document !== "undefined", "Can not set color scheme on the server");

    const darkColorSchemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const resolvedColorScheme =
        colorScheme === "system"
            ? darkColorSchemeMediaQuery.matches
                ? "dark"
                : "light"
            : colorScheme;

    document.documentElement.setAttribute("data-color", resolvedColorScheme);

    if (colorScheme === "system") {
        localStorage.removeItem("colorScheme");
    } else {
        localStorage.setItem("colorScheme", colorScheme);
    }

    colorSchemeEventEmitter.emit({
        colorScheme: resolvedColorScheme,
        isSystemPreference: colorScheme === "system",
    });
}

export function subscribeToColorSchemeChange(
    listener: ({
        colorScheme,
        isSystemPreference,
    }: {
        colorScheme: ColorScheme;
        isSystemPreference: boolean;
    }) => void,
) {
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
export function useColorScheme(): {
    colorScheme: ColorScheme | null;
    isSystemPreference: boolean | null;
} {
    const isInitialAppRender = useIsInitialAppRender();
    const [colorSchemeState, setColorSchemeState] = useState<{
        colorScheme: ColorScheme | null;
        isSystemPreference: boolean | null;
    }>({
        colorScheme: isInitialAppRender ? getColorSchemeWithoutListeningIfBrowser() : null,
        isSystemPreference: isInitialAppRender ? getIsSystemPreferenceIfBrowser() : null,
    });

    useEffect(() => {
        setColorSchemeState({
            colorScheme: getColorSchemeWithoutListeningIfBrowser(),
            isSystemPreference: getIsSystemPreferenceIfBrowser(),
        });

        const unsubscribe = subscribeToColorSchemeChange(setColorSchemeState);

        return () => {
            unsubscribe();
        };
    }, []);

    return colorSchemeState;
}
