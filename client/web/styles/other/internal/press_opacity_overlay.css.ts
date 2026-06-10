import {style} from "@vanilla-extract/css";
import {darkColorSchemeSelector} from "~/client/web/styles/core/styles_core.js";
import {extrapolateHighlightColor} from "~/client/web/styles/other/internal/helpers/extrapolate_highlight_color.js";
import {colors} from "~/shared/design/core/colors.js";
import {invertedColorsWithShade} from "~/shared/design/core/inverted_colors.js";

const opacity = 0.2;

/**
 * Class if you want your item's background color to go from `grey-0` to `grey-5`
 * when pressed but it has colorful contents so you want to use opacity to
 * accomplish this.
 *
 * This class does the math to get the right color with the right opacity for
 * turning `grey-0` into `grey-5`.
 */
export const pressOpacityOverlayClassName = style({
    backgroundColor: extrapolateHighlightColor(colors["grey-0"], colors["grey-5"], opacity),
    selectors: {
        [`${darkColorSchemeSelector} &`]: {
            backgroundColor: extrapolateHighlightColor(
                invertedColorsWithShade["grey-0"],
                invertedColorsWithShade["grey-5"],
                opacity,
            ),
        },
    },
});
