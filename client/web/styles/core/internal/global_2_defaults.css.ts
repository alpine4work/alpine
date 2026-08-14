/**
 * Opinionated global styles.
 *
 * If you want to remove browser styles or fix compatibility issues, put the style
 * in `bootstrap-style-reset.css.ts`.
 */

import {globalStyle} from "@vanilla-extract/css";
import {
    colorSchemeVars,
    darkColorSchemeSelector,
    initialSelectionColorsClassName,
    invertDarkSelectionColorsClassName,
    invertLightSelectionColorsClassName,
    invertSelectionColorsClassName,
    lightColorSchemeSelector,
} from "~/client/web/styles/core/internal/color_scheme.css.js";
import {fontSizes, fontStyles} from "~/client/web/styles/core/internal/fonts.css.js";
import {inputPlaceholderStyles} from "~/client/web/styles/core/internal/input_placeholder.css.js";
import {
    largeSpacingScaleSelector,
    mediumSpacingScaleSelector,
} from "~/client/web/styles/core/internal/selectors.css.js";
import {backgroundColorVar} from "~/client/web/styles/core/internal/sprinkles.css.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";

globalStyle(":root", {
    backgroundColor: colorSchemeVars["grey-0"],
    vars: {[backgroundColorVar]: colorSchemeVars["grey-0"]},
    color: colorSchemeVars["grey-100"],
    ...fontStyles.normal,

    // Change the size of 1rem based on our spacing scale.
    fontSize: remPxBySpacingScale.small,

    // By default we don't allow selecting any text. Instead individual elements must
    // opt-into text selection. This makes our UI feel more native. In a native UI you
    // can't select arbitrary button text or label text.
    userSelect: "none",
    // We need to set `cursor: "default"` since in Safari while `userSelect: "none"`
    // means text is not selectable it still has the text cursor.
    cursor: "default",

    // Disable Safari on iOS's highlight overlay on tap. By default when you tap on an
    // element Safari puts a grey highlight on it. Our components are responsible for
    // implementing their own touch feedback styles.
    WebkitTouchCallout: "none",
    WebkitTapHighlightColor: "rgba(0, 0, 0, 0)",
});

globalStyle(mediumSpacingScaleSelector, {
    fontSize: remPxBySpacingScale.medium,
});

globalStyle(largeSpacingScaleSelector, {
    fontSize: remPxBySpacingScale.large,
});

globalStyle("body", {
    // Use `75` as the default text size instead of 1rem. We want our default font to
    // be ideal for system text not user content.
    ...fontSizes["75"],
});

globalStyle("html, body", {
    // Use svh so our content fits even when there's content like a URL bar on iOS
    // Safari.
    minHeight: "100svh",
});

globalStyle("*", {
    // Remove focus outline from all elements. Components should manually add a focus
    // state using `useFocusRing()` which makes sure we don't apply a ring on mouse or
    // touch interaction.
    outline: "none",

    // Browsers add a 300ms delay to touches to detect a zoom. We can make taps 300ms
    // faster by disabling that functionality. This helps make our product feel native.
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

globalStyle(
    `${invertSelectionColorsClassName}::selection, ${invertSelectionColorsClassName} ::selection`,
    {background: colorSchemeVars["theme-selection-inverted"]},
);

globalStyle(
    `${lightColorSchemeSelector} ${invertLightSelectionColorsClassName}::selection, ${lightColorSchemeSelector} ${invertLightSelectionColorsClassName} ::selection`,
    {background: colorSchemeVars["theme-selection-inverted"]},
);

globalStyle(
    `${darkColorSchemeSelector} ${invertDarkSelectionColorsClassName}::selection, ${darkColorSchemeSelector} ${invertDarkSelectionColorsClassName} ::selection`,
    {background: colorSchemeVars["theme-selection-inverted"]},
);

// List the selector three times to increase precedence and beat our other
// selection classes.
globalStyle(
    `${initialSelectionColorsClassName}${initialSelectionColorsClassName}${initialSelectionColorsClassName}::selection, ${initialSelectionColorsClassName}${initialSelectionColorsClassName}${initialSelectionColorsClassName} ::selection`,
    {background: colorSchemeVars["theme-selection"]},
);
