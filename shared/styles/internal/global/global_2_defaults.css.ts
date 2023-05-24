/**
 * Opinionated global styles.
 *
 * If you want to remove browser styles or fix compatibility issues, put the
 * style in `bootstrap-style-reset.css.ts`.
 */

import {globalStyle} from "@vanilla-extract/css";
import {mobilePlatformMediaQuery, remPxByPlatform} from "~/shared/design/spacing";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css";
import {fontSizes, fontStyles} from "~/shared/styles/internal/fonts.css";
import {inputPlaceholderStyles} from "~/shared/styles/internal/input_placeholder.css";
import {backgroundColorVar} from "~/shared/styles/internal/sprinkles.css";

globalStyle(":root", {
    backgroundColor: colorSchemeVars["grey-wash"],
    vars: {[backgroundColorVar]: colorSchemeVars["grey-wash"]},
    color: colorSchemeVars["grey-text"],
    ...fontStyles.normal,

    // Change the size of 1rem based on whether we're on desktop or mobile.
    fontSize: remPxByPlatform.desktop,

    "@media": {
        [mobilePlatformMediaQuery]: {
            fontSize: remPxByPlatform.mobile,
        },
    },

    // By default we don't allow selecting any text. Instead individual elements
    // must opt-into text selection. This makes our UI feel more native. In a
    // native UI you can't select arbitrary button text or label text.
    userSelect: "none",
});

globalStyle("body", {
    // Use `75` as the default text size instead of 1rem. We want our default font
    // to be ideal for system text not user content.
    ...fontSizes["75"],
});

globalStyle("html, body, #__next", {
    height: "100%",
});

globalStyle("*", {
    // Remove focus outline from all elements. Components should manually add a
    // focus state using `useFocusRing()` which makes sure we don't apply a ring
    // on mouse or touch interaction.
    outline: "none",

    // Browsers add a 300ms delay to touches to detect a zoom. We can make taps
    // 300ms faster by disabling that functionality. This helps make our product
    // feel native.
    //
    // https://twitter.com/argyleink/status/1405881231695302659?s=21
    touchAction: "manipulation",
});

globalStyle("code, kbd, samp, pre", {
    ...fontStyles.code,
});

globalStyle("::placeholder", inputPlaceholderStyles);

globalStyle("::selection", {
    background: colorSchemeVars["theme-selection"],
});

globalStyle("::-moz-selection", {
    background: colorSchemeVars["theme-selection"],
});
