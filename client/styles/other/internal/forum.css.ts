import {style} from "@vanilla-extract/css";
import {
    darkColorSchemeSelector,
    largeSpacingScaleSelector,
    lightColorSchemeSelector,
    mediumSpacingScaleSelector,
    smallSpacingScaleSelector,
} from "~/client/styles/core/styles_core.js";
import {colorsWithShade, invertedColorsWithShade} from "~/shared/design/core/inverted_colors.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {convertSvgToDataUrl} from "~/shared/helpers/html/convert_svg_to_data_url.js";

export const fullScreenContentEditorClassName = style({
    paddingBottom: `calc(${spacing["24"]} + var(--safe-area-inset-bottom, 0px))`,
});

const remPxBySelector = {
    [smallSpacingScaleSelector]: remPxBySpacingScale.small,
    [mediumSpacingScaleSelector]: remPxBySpacingScale.medium,
    [largeSpacingScaleSelector]: remPxBySpacingScale.large,
};

const colorBySelector = {
    [lightColorSchemeSelector]: colorsWithShade["grey-5"],
    [darkColorSchemeSelector]: invertedColorsWithShade["grey-5"],
};

export const dashedBorderClassName = style({
    width: "100%",
    height: "1px",
    backgroundRepeat: "repeat-x",
    selectors: {
        // Override the background color set by sprinkles with a higher specificity
        // selector.
        "&&": {
            backgroundColor: "transparent",
        },
        ...Object.fromEntries(
            Object.entries(remPxBySelector).flatMap(([selector1, remPx]) =>
                Object.entries(colorBySelector).map(([selector2, color]) => [
                    `${selector1}${selector2} &`,
                    {
                        backgroundImage: `url("${convertSvgToDataUrl(
                            createDashedSvg(remPx * (3 / 4), color),
                        )}")`,
                    },
                ]),
            ),
        ),
    },
});

function createDashedSvg(w: number, color: string) {
    const w2 = w * (5 / 8);

    // prettier-ignore
    return `\
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 1">
    <path
        d="M 0 0.5, L ${w2} 0.5"
        fill="transparent"
        stroke="${color}"
        stroke-width="1"
        shape-rendering="geometricPrecision"
    />
</svg>`;
}
