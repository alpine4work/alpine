const initializeColorSchemeScript =
    'var colorScheme = localStorage.getItem("colorScheme"); var isDarkColorScheme = colorScheme === "dark" || !colorScheme && window.matchMedia("(prefers-color-scheme: dark)").matches; document.documentElement.dataset.colorScheme = isDarkColorScheme ? "dark" : "light";';

/**
 * A script that synchronously sets the color scheme on the `<html>`
 * element. Should be placed near the beginning of the page on all pages.
 *
 * This needs to be a synchronously executing script that blocks browser
 * rendering so that we don't render UI until the color scheme is correctly
 * initialized. On the server, the color scheme will always be light since the
 * server does not have access to local storage.
 *
 * If the user does not have an explicitly selected color scheme in local
 * storage then we initialize to their device preference.
 */
export function InitializeColorSchemeScript() {
    return <script dangerouslySetInnerHTML={{__html: initializeColorSchemeScript}} />;
}
