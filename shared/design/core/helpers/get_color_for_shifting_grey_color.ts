import * as kiwi from "@lume/kiwi";
import {colors} from "~/shared/design/core/colors.js";
import {
    RawColor,
    mixRawColors,
    parseRawColor,
    printRawColor,
} from "~/shared/design/core/helpers/raw_color.js";
import {invertedColorsWithShade} from "~/shared/design/core/inverted_colors.js";
import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";

export type GreyShade =
    | "0"
    | "1"
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
    | "99"
    | "100";

/**
 * Get a color that when applied to `currentShade` on top of `backgroundShade`
 * will result into the closest possible color to `targetShade`.
 */
export function getColorForShiftingGreyColor(
    targetAlpha: number,
    targetShade: GreyShade | {light: GreyShade; dark: GreyShade},
    backgroundShade: GreyShade | {light: GreyShade; dark: GreyShade},
): {light: string; dark: string} {
    const lightTargetShade = typeof targetShade === "string" ? targetShade : targetShade.light;
    const darkTargetShade = typeof targetShade === "string" ? targetShade : targetShade.dark;

    const lightBackgroundShade =
        typeof backgroundShade === "string" ? backgroundShade : backgroundShade.light;
    const darkBackgroundShade =
        typeof backgroundShade === "string" ? backgroundShade : backgroundShade.dark;

    const lightColor = actuallyGetColorForShiftingGreyColor(
        targetAlpha,
        parseRawColor(colors[`grey-${lightTargetShade}`]),
        parseRawColor(colors[`grey-${lightBackgroundShade}`]),
    );

    const darkColor = actuallyGetColorForShiftingGreyColor(
        targetAlpha,
        parseRawColor(invertedColorsWithShade[`grey-${darkTargetShade}`]),
        parseRawColor(invertedColorsWithShade[`grey-${darkBackgroundShade}`]),
    );

    return {
        light: printRawColor(lightColor),
        dark: printRawColor(darkColor),
    };
}

function actuallyGetColorForShiftingGreyColor(
    targetAlpha: number,
    targetColor: RawColor,
    backgroundColor: RawColor,
): RawColor {
    assert(backgroundColor.alpha === 1);

    const alphaIncrement = 1 / 255;
    targetAlpha = Math.round(targetAlpha * 255) / 255;

    for (let i = 0; i < 512; i++) {
        try {
            const alpha =
                i % 2 === 0
                    ? targetAlpha + alphaIncrement * Math.floor(i / 2)
                    : targetAlpha - alphaIncrement * Math.floor(i / 2);

            if (alpha < 0) continue;
            if (alpha > 1) continue;

            const solver = new kiwi.Solver();

            const rVariable = new kiwi.Variable();
            const gVariable = new kiwi.Variable();
            const bVariable = new kiwi.Variable();

            for (const variable of [rVariable, gVariable, bVariable]) {
                solver.addConstraint(
                    new kiwi.Constraint(variable, kiwi.Operator.Ge, 0, kiwi.Strength.required),
                );
                solver.addConstraint(
                    new kiwi.Constraint(variable, kiwi.Operator.Le, 255, kiwi.Strength.required),
                );
            }

            solver.addConstraint(
                new kiwi.Constraint(
                    rVariable.multiply(alpha).plus(backgroundColor.r * (1 - alpha)),
                    kiwi.Operator.Eq,
                    targetColor.r,
                    kiwi.Strength.required,
                ),
            );

            solver.addConstraint(
                new kiwi.Constraint(
                    gVariable.multiply(alpha).plus(backgroundColor.g * (1 - alpha)),
                    kiwi.Operator.Eq,
                    targetColor.g,
                    kiwi.Strength.required,
                ),
            );

            solver.addConstraint(
                new kiwi.Constraint(
                    bVariable.multiply(alpha).plus(backgroundColor.b * (1 - alpha)),
                    kiwi.Operator.Eq,
                    targetColor.b,
                    kiwi.Strength.required,
                ),
            );

            solver.updateVariables();

            const color = {
                r: rVariable.value(),
                g: gVariable.value(),
                b: bVariable.value(),
                alpha,
            };

            // Double check that `color` mixed with `backgroundColor` creates
            // `targetColor`.
            assert(isDeepEqual(mixRawColors(color, backgroundColor), targetColor));

            return color;
        } catch (error) {
            if (error instanceof Error && error.message.includes("unsatisfiable constraint")) {
                // Try again...
            } else {
                throw error;
            }
        }
    }

    throw new InternalError("Couldn\u2019t find color for shifting grey color");
}

/**
 * Get an opacity that when applied to `currentShade` on top of
 * `backgroundShade` will result into the closest possible color to
 * `targetShade`.
 */
export function approximateOpacityForShiftingGreyColor(
    currentShade: GreyShade,
    targetShade: GreyShade | {light: GreyShade; dark: GreyShade},
    backgroundShade: GreyShade | {light: GreyShade; dark: GreyShade},
): {light: number; dark: number} {
    const lightTargetShade = typeof targetShade === "string" ? targetShade : targetShade.light;
    const darkTargetShade = typeof targetShade === "string" ? targetShade : targetShade.dark;

    const lightBackgroundShade =
        typeof backgroundShade === "string" ? backgroundShade : backgroundShade.light;
    const darkBackgroundShade =
        typeof backgroundShade === "string" ? backgroundShade : backgroundShade.dark;

    return {
        light: actuallyApproximateOpacityForShiftingGreyColor(
            parseRawColor(colors[`grey-${currentShade}`]),
            parseRawColor(colors[`grey-${lightTargetShade}`]),
            parseRawColor(colors[`grey-${lightBackgroundShade}`]),
        ),
        dark: actuallyApproximateOpacityForShiftingGreyColor(
            parseRawColor(invertedColorsWithShade[`grey-${currentShade}`]),
            parseRawColor(invertedColorsWithShade[`grey-${darkTargetShade}`]),
            parseRawColor(invertedColorsWithShade[`grey-${darkBackgroundShade}`]),
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
