import {colors} from "~/shared/design/colors.js";
import {invertedColorsWithShade} from "~/shared/design/inverted_colors.js";
import {RawColor, mixRawColors, parseRawColor} from "~/shared/styles/internal/helpers/raw_color.js";

export type GreyShade =
    | "0"
    | "5"
    | "10"
    | "20"
    | "30"
    | "40"
    | "50"
    | "60"
    | "70"
    | "80"
    | "90"
    | "100";

/**
 * Get an opacity that when applied to `currentShade` on top of
 * `backgroundShade` will result into the closest possible color to
 * `targetShade`.
 */
export function approximateOpacityForShiftingGreyColor(
    currentShade: GreyShade,
    targetLightShade: GreyShade,
    targetDarkShade: GreyShade,
    backgroundShade: GreyShade,
): {light: number; dark: number} {
    return {
        light: actuallyApproximateOpacityForShiftingGreyColor(
            parseRawColor(colors[`grey-${currentShade}`]),
            parseRawColor(colors[`grey-${targetLightShade}`]),
            parseRawColor(colors[`grey-${backgroundShade}`]),
        ),
        dark: actuallyApproximateOpacityForShiftingGreyColor(
            parseRawColor(invertedColorsWithShade[`grey-${currentShade}`]),
            parseRawColor(invertedColorsWithShade[`grey-${targetDarkShade}`]),
            parseRawColor(invertedColorsWithShade[`grey-${backgroundShade}`]),
        ),
    };
}

function actuallyApproximateOpacityForShiftingGreyColor(
    currentColor: RawColor,
    targetColor: RawColor,
    backgroundColor: RawColor,
): number {
    const alphaIncrement = 0.005;
    const candidates: Array<{alpha: number; distance: number}> = [];

    // We use an iterative algorithm to find the `alpha` value with the
    // smallest distance from our `targetColor`. There's probably some
    // efficient equation we could write but since this code runs at build
    // time, we're ok with an expensive iterative approach.
    for (let alpha = currentColor.alpha; alpha > 0; alpha -= alphaIncrement) {
        const candidateColor = mixRawColors({...currentColor, alpha}, backgroundColor);

        // Distance between points in 4D RGBA space. Though RGBA space is not uniform
        // to the human eye. So this distance metric isn't perfect but it's good enough
        // for our purposes.
        const distance = Math.sqrt(
            (candidateColor.r - targetColor.r) ** 2 +
                (candidateColor.g - targetColor.g) ** 2 +
                (candidateColor.b - targetColor.b) ** 2 +
                (candidateColor.alpha - targetColor.alpha) ** 2,
        );

        candidates.push({alpha, distance});
    }

    candidates.sort((a, b) => a.distance - b.distance);

    return candidates[0]!.alpha;
}
