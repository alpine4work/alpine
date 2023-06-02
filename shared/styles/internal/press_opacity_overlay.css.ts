import {style} from "@vanilla-extract/css";
import {colors} from "~/shared/design/colors";
import {darkColorSchemeSelector, invertedColors} from "~/shared/styles/internal/color_scheme.css";
import {extrapolateHighlightColor} from "~/shared/styles/internal/helpers/extrapolate_highlight_color";

const opacity = 0.1;

/**
 * Class if you want your item's background color to go from `grey-0` to
 * `grey-5` when pressed but it has colorful contents so you want to use
 * opacity to accomplish this.
 *
 * This class does the math to get the right color with the right opacity for
 * turning `grey-0` into `grey-5`.
 */
export const pressOpacityOverlayClassName = style({
    backgroundColor: extrapolateHighlightColor(colors["grey-0"], colors["grey-5"], opacity),
    selectors: {
        [`${darkColorSchemeSelector} &`]: {
            backgroundColor: extrapolateHighlightColor(
                invertedColors["grey-0"],
                invertedColors["grey-5"],
                opacity,
            ),
        },
    },
});
