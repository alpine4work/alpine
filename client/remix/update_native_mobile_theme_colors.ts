import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {colorSchemeVars} from "~/shared/styles/styles.js";

/**
 * Send our current theme colors to our native mobile wrapper up. Call this
 * whenever the theme colors change.
 */
export function updateNativeMobileThemeColors() {
    if (!NativeMobileBridge) return;

    const style = getComputedStyle(document.body);
    const varRegExp = /^var\(([^)]*)\)$/;

    NativeMobileBridge.colors.setThemeColors({
        "theme-30": style.getPropertyValue(colorSchemeVars["theme-30"].replace(varRegExp, "$1")),
        "theme-40": style.getPropertyValue(colorSchemeVars["theme-40"].replace(varRegExp, "$1")),
        "theme-50": style.getPropertyValue(colorSchemeVars["theme-50"].replace(varRegExp, "$1")),
        "theme-60": style.getPropertyValue(colorSchemeVars["theme-60"].replace(varRegExp, "$1")),
    });
}
