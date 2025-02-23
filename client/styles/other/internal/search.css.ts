import {style} from "@vanilla-extract/css";
import {
    colorSchemeVars,
    darkColorSchemeSelector,
    largeSpacingScaleSelector,
    mediumSpacingScaleSelector,
} from "~/client/styles/core/styles_core.js";
import {paragraphLineHeightVar} from "~/client/styles/other/internal/content.css.js";
import {approximateOpacityForShiftingGreyColor} from "~/client/styles/other/internal/helpers/approximate_opacity_for_shifting_grey_color.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";

const brandIconColorGreyShade = "80";
const brandIconColorGreyTargetLightShade = "60";
const brandIconColorGreyTargetDarkShade = "70";
export const brandIconColor = colorSchemeVars[`grey-${brandIconColorGreyShade}`];

const opacity = approximateOpacityForShiftingGreyColor(
    brandIconColorGreyShade,
    brandIconColorGreyTargetLightShade,
    brandIconColorGreyTargetDarkShade,
    "0",
);

export const brandIconOpacityClassName = style({
    opacity: opacity.light,
    selectors: {
        [`${darkColorSchemeSelector} &`]: {
            opacity: opacity.dark,
        },
    },
});

// NOTE(calebmer): I'm not entirely sold on this design choice for search
// results with a body but no title. We need to show the search result media on
// the first line (which requires a large line height) so we increase the line
// height of just the first line of body text. Then we also increase the font
// size of the first line of body text a bit otherwise the gap between the
// first line and the rest of the content looks weird.
//
// This is the best I can think of right now. Maybe we should work towards
// always having a title for all search results.
export const bodyTextSnippetWithoutTitleClassName = style({
    selectors: {
        "&::first-line": {
            fontSize: fontSizesBySpacingScale["75"].small.fontSize + 1,
            lineHeight: paragraphLineHeightVar,
        },
        [`${mediumSpacingScaleSelector} &::first-line`]: {
            fontSize: fontSizesBySpacingScale["75"].medium.fontSize + 1,
        },
        [`${largeSpacingScaleSelector} &::first-line`]: {
            fontSize: fontSizesBySpacingScale["75"].large.fontSize + 1,
        },
    },
});
