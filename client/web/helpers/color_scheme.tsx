/* eslint-disable react-refresh/only-export-components */

import {useEffect, useState} from "react";
import {flushSync} from "react-dom";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.open_source.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.open_source.js";

export type ColorScheme = "light" | "dark";

const colorSchemeEventEmitter = new EventEmitter<{
    colorScheme: ColorScheme;
    isSystemPreference: boolean;
}>();

/**
 * Get the current color scheme without listening to future updates if we are
 * executing in a browser client.
 */
export function getColorSchemeWithoutListeningIfBrowser(): ColorScheme | null {
    if (typeof document === "undefined") return null;
    return document.documentElement.getAttribute("data-color") === "dark" ? "dark" : "light";
}

/**
 * Get the color scheme ignoring any overrides.
 */
function actuallyGetUnresolvedColorSchemeWithoutListening(): ColorScheme | "system" {
    assert(typeof document !== "undefined");

    const colorScheme = localStorage.getItem("colorScheme");

    if (colorScheme === null) return "system";
    if (colorScheme === "dark") return "dark";
    return "light";
}

/**
 * Get the color scheme ignoring any overrides.
 */
function actuallyGetResolvedColorSchemeWithoutListening(): ColorScheme {
    const colorScheme = actuallyGetUnresolvedColorSchemeWithoutListening();
    return resolveColorSchemeWithoutListening(colorScheme);
}

function resolveColorSchemeWithoutListening(colorScheme: ColorScheme | "system"): ColorScheme {
    if (colorScheme !== "system") return colorScheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Get whether the color scheme was set by the system preference.
 */
function getIsColorSchemeSystemPreferenceIfBrowser(): boolean | null {
    if (typeof localStorage === "undefined") return null;
    return !localStorage.getItem("colorScheme");
}

/**
 * Switch the color scheme. If the color scheme is light, we switch to dark. If the
 * color scheme is dark, we switch to light.
 *
 * Calling this function once means we will no longer inherit the system setting.
 */
export function toggleColorScheme() {
    const colorScheme = actuallyGetResolvedColorSchemeWithoutListening();
    setColorScheme(colorScheme === "dark" ? "light" : "dark");
}

export function setColorScheme(colorScheme: ColorScheme | "system") {
    assert(typeof document !== "undefined");

    // If you call `setColorScheme()` it'll set the underlying color scheme in
    // `localStorage` but if there's an override we'll still render the override.
    if (colorScheme === "system") {
        localStorage.removeItem("colorScheme");
    } else {
        localStorage.setItem("colorScheme", colorScheme);
    }

    const resolvedColorScheme =
        colorSchemeOverride ?? resolveColorSchemeWithoutListening(colorScheme);

    if (resolvedColorScheme !== document.documentElement.getAttribute("data-color")) {
        actuallySetDocumentElementColorSchemeAttribute({
            resolvedColorScheme,
            isSystemPreference: colorScheme === "system",
        });
    }
}

function actuallySetDocumentElementColorSchemeAttribute({
    resolvedColorScheme,
    isSystemPreference,
}: {
    resolvedColorScheme: ColorScheme;
    isSystemPreference: boolean;
}) {
    // Disable all CSS transitions when we change the color scheme. So anything with
    // `transition: background-color` (notably `<SwitchIcon>` and `<ShareSwitchBase>`)
    // change their color instantly instead of animating when the color scheme changes.
    const styleElement = document.createElement("style");
    styleElement.textContent = "*, *::before, *::after { transition: none !important }";
    document.head.appendChild(styleElement);

    document.documentElement.setAttribute("data-color", resolvedColorScheme);

    flushSync(() => {
        colorSchemeEventEmitter.emit({
            colorScheme: resolvedColorScheme,
            isSystemPreference,
        });
    });

    // Wait for the browser to paint a frame before removing our CSS transition
    // override.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            styleElement.remove();
        });
    });
}

let colorSchemeOverride: ColorScheme | null = null;

/**
 * Override the color scheme. Make sure to clean up your color scheme override when
 * you're done. Currently this is just used for printing.
 *
 * This doesn't change the color scheme in `localStorage`. So reloading the page
 * resets the override. Also any other browser tabs won't see the override.
 */
export function overrideColorScheme(newColorSchemeOverride: ColorScheme | null) {
    assert(typeof document !== "undefined");

    colorSchemeOverride = newColorSchemeOverride;

    if (colorSchemeOverride !== null) {
        if (colorSchemeOverride !== document.documentElement.getAttribute("data-color")) {
            actuallySetDocumentElementColorSchemeAttribute({
                resolvedColorScheme: colorSchemeOverride,
                isSystemPreference: actuallyGetUnresolvedColorSchemeWithoutListening() === "system",
            });
        }
    } else {
        const colorScheme = actuallyGetUnresolvedColorSchemeWithoutListening();
        const resolvedColorScheme = resolveColorSchemeWithoutListening(colorScheme);

        if (resolvedColorScheme !== document.documentElement.getAttribute("data-color")) {
            actuallySetDocumentElementColorSchemeAttribute({
                resolvedColorScheme,
                isSystemPreference: colorScheme === "system",
            });
        }
    }
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
 * Get the color scheme and re-render the component when the color scheme changes.
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
    }>(() => ({
        colorScheme: !isInitialAppRender ? getColorSchemeWithoutListeningIfBrowser() : null,
        isSystemPreference: !isInitialAppRender
            ? getIsColorSchemeSystemPreferenceIfBrowser()
            : null,
    }));

    useEffect(() => {
        const update = (newColorSchemeState: {
            colorScheme: ColorScheme;
            isSystemPreference: boolean;
        }) => {
            setColorSchemeState(oldColorSchemeState => {
                if (isDeepEqual(oldColorSchemeState, newColorSchemeState)) {
                    return oldColorSchemeState;
                }
                return newColorSchemeState;
            });
        };

        update({
            colorScheme: assertExists(getColorSchemeWithoutListeningIfBrowser()),
            isSystemPreference: assertExists(getIsColorSchemeSystemPreferenceIfBrowser()),
        });

        return subscribeToColorSchemeChange(update);
    }, []);

    return colorSchemeState;
}

const initializeColorSchemeScript =
    // eslint-disable-next-line cyberworlds/string-quotes
    'var colorScheme = localStorage.getItem("colorScheme"); var isDarkColorScheme = colorScheme === "dark" || !colorScheme && window.matchMedia("(prefers-color-scheme: dark)").matches; document.documentElement.setAttribute("data-color", isDarkColorScheme ? "dark" : "light");';

/**
 * Manages the color scheme for the page. Importantly, contains a script that
 * synchronously initializes the color scheme on the `<html>` element. Should be
 * placed in the `<head>` on all pages.
 *
 * The script needs to be a synchronously executing script that blocks browser
 * rendering so that we don't render UI until the color scheme is initialized.
 *
 * If the user does not have an explicitly selected color scheme in local storage
 * then we initialize to their device preference.
 *
 * Also subscribes to device color scheme preference changes. So we can re-render
 * in light/dark mode when the user changes their configuration. Useful if the
 * device is configured to be dark mode at night and light mode during the day.
 */
export function ColorSchemeManager() {
    useEffect(() => {
        const darkColorSchemeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

        const updateMediaQuery = () => {
            const colorScheme = actuallyGetUnresolvedColorSchemeWithoutListening();
            const resolvedColorScheme =
                colorSchemeOverride ?? resolveColorSchemeWithoutListening(colorScheme);

            if (resolvedColorScheme !== document.documentElement.getAttribute("data-color")) {
                actuallySetDocumentElementColorSchemeAttribute({
                    resolvedColorScheme,
                    isSystemPreference: colorScheme === "system",
                });
            }
        };

        darkColorSchemeMediaQuery.addEventListener("change", updateMediaQuery);
        return () => {
            darkColorSchemeMediaQuery.removeEventListener("change", updateMediaQuery);
        };
    }, []);

    return <script dangerouslySetInnerHTML={{__html: initializeColorSchemeScript}} />;
}
