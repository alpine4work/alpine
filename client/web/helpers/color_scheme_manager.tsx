import {useEffect} from "react";
import {colorSchemeEventEmitter} from "~/client/web/helpers/internal/color_scheme_event_emitter.js";

const initializeColorSchemeScript =
    // eslint-disable-next-line string-quotes
    'var colorScheme = localStorage.getItem("colorScheme"); var isDarkColorScheme = colorScheme === "dark" || !colorScheme && window.matchMedia("(prefers-color-scheme: dark)").matches; document.documentElement.setAttribute("data-color", isDarkColorScheme ? "dark" : "light");';

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

        const updateMediaQuery = () => {
            const colorSchemeString = localStorage.getItem("colorScheme");

            const isDarkColorScheme =
                colorSchemeString === "dark" ||
                (!colorSchemeString && darkColorSchemeMediaQuery.matches);

            const colorScheme = isDarkColorScheme ? "dark" : "light";

            if (colorScheme !== document.documentElement.getAttribute("data-color")) {
                document.documentElement.setAttribute("data-color", colorScheme);

                colorSchemeEventEmitter.emit(colorScheme);
            }
        };

        darkColorSchemeMediaQuery.addEventListener("change", updateMediaQuery);
        return () => {
            darkColorSchemeMediaQuery.removeEventListener("change", updateMediaQuery);
        };
    }, []);

    return <script dangerouslySetInnerHTML={{__html: initializeColorSchemeScript}} />;
}
