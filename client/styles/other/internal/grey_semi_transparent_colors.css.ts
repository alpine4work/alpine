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

// The darker the shade, the lower the opacity, the less the border will show
// up when rendered on top of an image.
const grey10SemiTransparentColorShade = "100";

const grey10SemiTransparentColorOpacity = approximateOpacityForShiftingGreyColor(
    grey10SemiTransparentColorShade,
    "10",
    "10",
    "0",
);

const grey10SemiTransparentColorWithoutOpacity = {
    light: Color(colors[`grey-${grey10SemiTransparentColorShade}`]),
    dark: Color(invertedColorsWithShade[`grey-${grey10SemiTransparentColorShade}`]),
};

const grey10SemiTransparentColor = {
    light: Color.rgb(
        grey10SemiTransparentColorWithoutOpacity.light.red(),
        grey10SemiTransparentColorWithoutOpacity.light.green(),
        grey10SemiTransparentColorWithoutOpacity.light.blue(),
        grey10SemiTransparentColorOpacity.light,
    ).hexa(),
    dark: Color.rgb(
        grey10SemiTransparentColorWithoutOpacity.dark.red(),
        grey10SemiTransparentColorWithoutOpacity.dark.green(),
        grey10SemiTransparentColorWithoutOpacity.dark.blue(),
        grey10SemiTransparentColorOpacity.dark,
    ).hexa(),
};

const grey100ToGrey80Opacity = approximateOpacityForShiftingGreyColor(
    grey5SemiTransparentColorShade,
    "80",
    "80",
    "0",
);

export const grey5SemiTransparentColorVar = createVar("grey-5-semi-transparent");
export const grey10SemiTransparentColorVar = createVar("grey-10-semi-transparent");
export const grey100ToGrey80OpacityVar = createVar("grey-100-to-grey-80-opacity");

globalStyle(":root", {
    vars: {
        [grey5SemiTransparentColorVar]: grey5SemiTransparentColor.light,
        [grey10SemiTransparentColorVar]: grey10SemiTransparentColor.light,
        [grey100ToGrey80OpacityVar]: `${grey100ToGrey80Opacity.light}`,
    },
});

globalStyle(darkColorSchemeSelector, {
    vars: {
        [grey5SemiTransparentColorVar]: grey5SemiTransparentColor.dark,
        [grey10SemiTransparentColorVar]: grey10SemiTransparentColor.dark,
        [grey100ToGrey80OpacityVar]: `${grey100ToGrey80Opacity.dark}`,
    },
});
