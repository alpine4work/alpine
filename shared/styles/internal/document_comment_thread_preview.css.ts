import {style} from "@vanilla-extract/css";
import {colors} from "~/shared/design/colors";
import {darkColorSchemeSelector, invertedColors} from "~/shared/styles/internal/color_scheme.css";
import {extrapolateHighlightColor} from "~/shared/styles/internal/helpers/extrapolate_highlight_color";

const opacity = 0.1;

export const pressOverlayClassName = style({
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
