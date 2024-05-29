import {style} from "@vanilla-extract/css";
import {
    colorSchemeVars,
    darkColorSchemeSelector,
} from "~/shared/styles/internal/color_scheme.css.js";
import {approximateOpacityForShiftingGreyColor} from "~/shared/styles/internal/helpers/approximate_opacity_for_shifting_grey_color.js";

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
