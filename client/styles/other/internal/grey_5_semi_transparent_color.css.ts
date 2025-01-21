import {createVar, globalStyle} from "@vanilla-extract/css";
import Color from "color";
import {darkColorSchemeSelector} from "~/client/styles/core/styles_core.js";
import {approximateOpacityForShiftingGreyColor} from "~/client/styles/other/internal/helpers/approximate_opacity_for_shifting_grey_color.js";
import {colors} from "~/shared/design/core/colors.js";
import {invertedColorsWithShade} from "~/shared/design/core/inverted_colors.js";

// The darker the shade, the lower the opacity, the less the border will show
// up when rendered on top of an image.
const grey5SemiTransparentColorShade = "100";

const grey5SemiTransparentColorOpacity = approximateOpacityForShiftingGreyColor(
    grey5SemiTransparentColorShade,
    "5",
    "5",
    "0",
);

const grey5SemiTransparentColorWithoutOpacity = {
    light: Color(colors[`grey-${grey5SemiTransparentColorShade}`]),
    dark: Color(invertedColorsWithShade[`grey-${grey5SemiTransparentColorShade}`]),
};

const grey5SemiTransparentColor = {
    light: Color.rgb(
        grey5SemiTransparentColorWithoutOpacity.light.red(),
        grey5SemiTransparentColorWithoutOpacity.light.green(),
        grey5SemiTransparentColorWithoutOpacity.light.blue(),
        grey5SemiTransparentColorOpacity.light,
    ).hexa(),
    dark: Color.rgb(
        grey5SemiTransparentColorWithoutOpacity.dark.red(),
        grey5SemiTransparentColorWithoutOpacity.dark.green(),
        grey5SemiTransparentColorWithoutOpacity.dark.blue(),
        grey5SemiTransparentColorOpacity.dark,
    ).hexa(),
};

export const grey5SemiTransparentColorVar = createVar("grey-5-semi-transparent");

globalStyle(":root", {
    vars: {
        [grey5SemiTransparentColorVar]: grey5SemiTransparentColor.light,
    },
});

globalStyle(darkColorSchemeSelector, {
    vars: {
        [grey5SemiTransparentColorVar]: grey5SemiTransparentColor.dark,
    },
});
