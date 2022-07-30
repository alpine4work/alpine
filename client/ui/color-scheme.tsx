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

/**
 * Switch the color scheme. If the color scheme is light, we switch to dark. If
 * the color scheme is dark, we switch to light.
 *
 * Calling this function once means we will no longer inherit the system
 * setting.
 */
export function toggleColorScheme() {
    const isDarkMode = document.documentElement.dataset.colorScheme === "dark";
    const newColorScheme = isDarkMode ? "light" : "dark";
    document.documentElement.dataset.colorScheme = newColorScheme;
    localStorage.setItem("colorScheme", newColorScheme);
}
