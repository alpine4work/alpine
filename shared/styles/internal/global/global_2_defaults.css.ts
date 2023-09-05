/**
 * Opinionated global styles.
 *
 * If you want to remove browser styles or fix compatibility issues, put the
 * style in `bootstrap-style-reset.css.ts`.
 */

import {globalStyle} from "@vanilla-extract/css";
import {mobilePlatformMediaQuery, remPxByPlatform, spacing} from "~/shared/design/spacing.js";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css.js";
import {fontSizes, fontStyles} from "~/shared/styles/internal/fonts.css.js";
import {inputPlaceholderStyles} from "~/shared/styles/internal/input_placeholder.css.js";
import {backgroundColorVar} from "~/shared/styles/internal/sprinkles.css.js";

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

// Customize our scrollbars in Chrome and Safari.
//
// Resources for custom scrollbars with CSS:
//
// - https://ishadeed.com/article/custom-scrollbars-css/
// - https://css-tricks.com/almanac/properties/s/scrollbar/
//
// TODO(calebmer): To really ensure scrollbar consistency I think one day we
// may need a custom scrollbar implementation in JavaScript. Right now
// scrollbars in Firefox aren't the prettiest and it's a little hacky how we
// get rounded corners right.
//
// If we do write our own scrollbar, we should make it work well with infinite
// loaded content! So if you're dragging the scrollbar and new content is
// loaded the scrollbar doesn't jump out from under your cursor.
//
// Or use this module. It looks pretty good.
// https://kingsora.github.io/OverlayScrollbars/
globalStyle("::-webkit-scrollbar", {
    width: spacing["3"],
});

globalStyle("::-webkit-scrollbar-track", {
    boxShadow: `inset 1px 0 0 ${colorSchemeVars["grey-5"]}`,
});

// We offset the border and border radius by 1px since the track has a
// left border.
globalStyle("::-webkit-scrollbar-thumb", {
    border: `${spacing["0.5"]} solid transparent`,
    borderLeftWidth: `calc(${spacing["0.5"]} + 1px)`,
    borderTopRightRadius: spacing["1.5"],
    borderBottomRightRadius: spacing["1.5"],
    // We add 1px to our left border so we want a bit more border radius on the
    // left. We've found that `1 - 1/π` looks the most correct but haven't done the
    // math to determine why that is.
    borderTopLeftRadius: `calc(${spacing["1.5"]} + ${1 - 1 / Math.PI}px)`,
    borderBottomLeftRadius: `calc(${spacing["1.5"]} + ${1 - 1 / Math.PI}px)`,
    backgroundColor: colorSchemeVars["grey-10"],
    backgroundClip: "padding-box",
});

globalStyle("::-webkit-scrollbar-thumb:hover", {
    backgroundColor: colorSchemeVars["grey-20"],
});

globalStyle("::-webkit-scrollbar-button", {
    width: 0,
    height: 0,
    display: "none",
});

globalStyle("::-webkit-scrollbar-corner", {
    backgroundColor: "transparent",
});

// Customize our scrollbars in Firefox.
//
// Ideally we'd have a left border on our scrollbars but that's not supported
// in Firefox.
globalStyle("*", {
    // @ts-expect-error
    scrollbarWidth: spacing["3"],
    scrollbarColor: `${colorSchemeVars["grey-10"]} transparent`,
});
