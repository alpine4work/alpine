/*!
 * Opinionated global styles.
 *
 * If you want to remove browser styles or fix compatibility issues, put the
 * style in `bootstrap-style-reset.css.ts`.
 */

import {globalStyle} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/client/ui/color-scheme.css";
import {mobileMediaQuery} from "~/client/ui/sprinkles.css";
import {remPx} from "~/shared/styles/spacing";

globalStyle(":root", {
    backgroundColor: colorSchemeVars["grey-0"],
    color: colorSchemeVars["grey-100"],

    // Use system sans-serif font.
    fontFamily:
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',

    // Change the size of 1rem based on whether we're on desktop or mobile.
    fontSize: remPx.desktop,
    "@media": {
        [mobileMediaQuery]: {
            fontSize: remPx.mobile,
        },
    },

    // Nicer looking text rendering.
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",

    // By default we don't allow selecting any text. Instead individual elements
    // must opt-into text selection. This makes our UI feel more native. In a
    // native UI you can't select arbitrary button text or label text.
    userSelect: "none",
});

globalStyle("*", {
    // Browsers add a 300ms delay to touches to detect a zoom. We can make taps
    // 300ms faster by disabling that functionality. This helps make our product
    // feel native.
    //
    // https://twitter.com/argyleink/status/1405881231695302659?s=21
    touchAction: "manipulation",
});

globalStyle("code, kbd, samp, pre", {
    // Use system monospace font.
    fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
});
