import {style} from "@vanilla-extract/css";
import {colorsWithShade, invertedColorsWithShade} from "~/shared/design/inverted_colors.js";
import {
    mobilePlatformMediaQuery,
    parseRemLengthNumber,
    remPxByPlatform,
    spacing,
} from "~/shared/design/spacing.js";
import {darkColorSchemeSelector} from "~/shared/styles/internal/color_scheme.css.js";
import {convertSvgToCssDataUrl} from "~/shared/styles/internal/helpers/convert_svg_to_css_data_url.js";

const dashHeight = "2";
const dashStrokeWidth = "1.5";
const dashGapWidth = "1.5";

const dashHeightRem = parseRemLengthNumber(spacing[dashHeight]);
const dashStrokeWidthRem = parseRemLengthNumber(spacing[dashStrokeWidth]);
const dashGapWidthRem = parseRemLengthNumber(spacing[dashGapWidth]);

export const dashedBorderClassName = style({
    width: "100%",
    height: `${dashHeightRem}rem`,
    backgroundRepeat: "repeat-x",
    backgroundImage: convertSvgToCssDataUrl(
        createDashedSvg(
            dashHeightRem * remPxByPlatform.desktop,
            dashStrokeWidthRem * remPxByPlatform.desktop,
            dashGapWidthRem * remPxByPlatform.desktop,
            colorsWithShade["grey-5"],
        ),
    ),
    selectors: {
        [`${darkColorSchemeSelector} &`]: {
            backgroundImage: convertSvgToCssDataUrl(
                createDashedSvg(
                    dashHeightRem * remPxByPlatform.desktop,
                    dashStrokeWidthRem * remPxByPlatform.desktop,
                    dashGapWidthRem * remPxByPlatform.desktop,
                    invertedColorsWithShade["grey-5"],
                ),
            ),
        },
    },
    "@media": {
        [mobilePlatformMediaQuery]: {
            backgroundImage: convertSvgToCssDataUrl(
                createDashedSvg(
                    dashHeightRem * remPxByPlatform.mobile,
                    dashStrokeWidthRem * remPxByPlatform.mobile,
                    dashGapWidthRem * remPxByPlatform.mobile,
                    colorsWithShade["grey-5"],
                ),
            ),
            selectors: {
                [`${darkColorSchemeSelector} &`]: {
                    backgroundImage: convertSvgToCssDataUrl(
                        createDashedSvg(
                            dashHeightRem * remPxByPlatform.mobile,
                            dashStrokeWidthRem * remPxByPlatform.mobile,
                            dashGapWidthRem * remPxByPlatform.mobile,
                            invertedColorsWithShade["grey-5"],
                        ),
                    ),
                },
            },
        },
    },
});

function createDashedSvg(h: number, w1: number, w2: number, color: string) {
    // prettier-ignore
    return `\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w1 + w2} ${h}">
    <path
        d="M 0 ${h / 2 - 0.5}, L ${w1} ${h / 2 - 0.5}"
        fill="transparent"
        stroke="${color}"
        stroke-width="1"
        shape-rendering="geometricPrecision"
    />
</svg>`;
}
