/*!
 * Opinionated global styles.
 *
 * If you want to remove browser styles or fix compatibility issues, put the
 * style in `bootstrap-style-reset.css.ts`.
 */

import {globalStyle} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/client/ui/color-scheme.css";
import {mobileMediaQuery} from "~/client/ui/sprinkles.css";
import {assert} from "~/shared/helpers/control/assert";
import {fontScale, monospaceFontFamily, sansSerifFontFamily} from "~/shared/styles/fonts";
import {remPx} from "~/shared/styles/spacing";

// Since we use the `fontScale.base` line height as our default, let's make
// sure the font size is 1rem.
assert(fontScale.base.fontSize === "1rem");

globalStyle(":root", {
    backgroundColor: colorSchemeVars["grey-0"],
    color: colorSchemeVars["grey-100"],
    fontFamily: sansSerifFontFamily,

    // Change the size of 1rem based on whether we're on desktop or mobile.
    fontSize: remPx.desktop,
    lineHeight: fontScale.base.lineHeight,
    letterSpacing: fontScale.base.letterSpacing,
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

globalStyle("body", {
    // Actually use `sm` as the default size. We want our default font to be
    // ideal for system text not user content.
    fontSize: fontScale.sm.fontSize,
    lineHeight: fontScale.sm.lineHeight,
    letterSpacing: fontScale.sm.letterSpacing,
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
    fontFamily: monospaceFontFamily,
});
