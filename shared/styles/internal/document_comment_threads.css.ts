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

export const sawtoothSize = "4";
export const sawtoothSizeRem = parseRemLengthNumber(spacing[sawtoothSize]);

export const sawtoothBorderClassName = style({
    width: "100%",
    height: `${sawtoothSizeRem}rem`,
    backgroundRepeat: "repeat-x",
    backgroundImage: convertSvgToCssDataUrl(
        createSawtoothSvg(sawtoothSizeRem * remPxByPlatform.desktop, colorsWithShade["grey-10"]),
    ),
    selectors: {
        [`${darkColorSchemeSelector} &`]: {
            backgroundImage: convertSvgToCssDataUrl(
                createSawtoothSvg(
                    sawtoothSizeRem * remPxByPlatform.desktop,
                    invertedColorsWithShade["grey-10"],
                ),
            ),
        },
    },
    "@media": {
        [mobilePlatformMediaQuery]: {
            backgroundImage: convertSvgToCssDataUrl(
                createSawtoothSvg(
                    sawtoothSizeRem * remPxByPlatform.mobile,
                    colorsWithShade["grey-10"],
                ),
            ),
            selectors: {
                [`${darkColorSchemeSelector} &`]: {
                    backgroundImage: convertSvgToCssDataUrl(
                        createSawtoothSvg(
                            sawtoothSizeRem * remPxByPlatform.mobile,
                            invertedColorsWithShade["grey-10"],
                        ),
                    ),
                },
            },
        },
    },
});

function createSawtoothSvg(w: number, color: string) {
    const h1 = w * (1 / 4);
    const h2 = w * (3 / 4);

    const w2 = w / 2;

    // prettier-ignore
    return `\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w * 2} ${w}">
    <path
        d="M ${-w2} ${h1}, L 0 ${h2}, L ${w2} ${h1}, L ${w2 * 2} ${h2}, L ${w2 * 3} ${h1}, L ${w2 * 4} ${h2}, L ${w2 * 5} ${h1}"
        fill="transparent"
        stroke="${color}"
        stroke-width="1"
        shape-rendering="geometricPrecision"
    />
</svg>`;
}
