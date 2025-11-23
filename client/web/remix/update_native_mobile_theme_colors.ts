import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {colorSchemeVars} from "~/client/web/styles/styles.js";

/**
 * Send our current theme colors to our native mobile wrapper up. Call this
 * whenever the theme colors change.
 */
export function updateNativeMobileThemeColors() {
    if (!NativeMobileBridge) return;

    const style = getComputedStyle(document.body);
    const varRegExp = /^var\(([^)]*)\)$/;

    NativeMobileBridge.colors.setThemeColors({
        "theme-10": style.getPropertyValue(colorSchemeVars["theme-10"].replace(varRegExp, "$1")),
        "theme-20": style.getPropertyValue(colorSchemeVars["theme-20"].replace(varRegExp, "$1")),
        "theme-30": style.getPropertyValue(colorSchemeVars["theme-30"].replace(varRegExp, "$1")),
        "theme-40": style.getPropertyValue(colorSchemeVars["theme-40"].replace(varRegExp, "$1")),
        "theme-50": style.getPropertyValue(colorSchemeVars["theme-50"].replace(varRegExp, "$1")),
        "theme-60": style.getPropertyValue(colorSchemeVars["theme-60"].replace(varRegExp, "$1")),
        "theme-70": style.getPropertyValue(colorSchemeVars["theme-70"].replace(varRegExp, "$1")),
        "theme-80": style.getPropertyValue(colorSchemeVars["theme-80"].replace(varRegExp, "$1")),
        "theme-90": style.getPropertyValue(colorSchemeVars["theme-90"].replace(varRegExp, "$1")),
    });
}
