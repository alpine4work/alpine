import {style} from "@vanilla-extract/css";
import {
    darkColorSchemeSelector,
    lightColorSchemeSelector,
    selectorBySpacingScale,
} from "~/client/styles/core/styles_core.js";
import {colorsWithShade, invertedColorsWithShade} from "~/shared/design/core/inverted_colors.js";
import {parseRemLength} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {convertSvgToDataUrl} from "~/shared/helpers/html/convert_svg_to_data_url.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";

export const sawtoothSize = "4";
export const sawtoothSizeRem = parseRemLength(sawtoothSize);

const colorBySelector = {
    [lightColorSchemeSelector]: colorsWithShade["grey-10"],
    [darkColorSchemeSelector]: invertedColorsWithShade["grey-10"],
};

export const sawtoothBorderClassName = style({
    width: "100%",
    height: `${sawtoothSizeRem}rem`,
    backgroundRepeat: "repeat-x",
    selectors: Object.fromEntries(
        getObjectEntriesWithKeyofType(selectorBySpacingScale).flatMap(([spacingScale, selector1]) =>
            Object.entries(colorBySelector).map(([selector2, color]) => [
                `${selector1}${selector2} &`,
                {
                    backgroundImage: `url("${convertSvgToDataUrl(
                        createSawtoothSvg(
                            sawtoothSizeRem * remPxBySpacingScale[spacingScale],
                            color,
                        ),
                    )}")`,
                },
            ]),
        ),
    ),
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
