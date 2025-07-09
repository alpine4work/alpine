import {RawColor, parseRawColor, printRawColor} from "~/shared/design/core/helpers/raw_color.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {lerp} from "~/shared/helpers/number/lerp.js";

/**
 * Return a translucent color that when rendered on top of `backgroundColor`
 * produces `highlightColor`.
 *
 * An example use-case is the document highlight style. We want our highlight
 * styles to present as a color on our color scale. However, when they render
 * over some other color we want the two to mix so the highlight color needs
 * to be somewhat translucent.
 *
 * It's not always possible to extrapolate a highlight color! This function
 * throws if we can't create a color in the RGB color space with the
 * desired effect.
 */
export function extrapolateHighlightColor(
    backgroundColor: string,
    highlightColor: string,
    opacity: number,
): string {
    const color = extrapolateHighlightRawColorWithoutBounds(
        parseRawColor(backgroundColor),
        parseRawColor(highlightColor),
        opacity,
    );

    assert(
        0 <= color.r &&
            color.r <= 255 &&
            0 <= color.g &&
            color.g <= 255 &&
            0 <= color.b &&
            color.b <= 255,
        `Can not extrapolate outside RGB color space, got color: rgb(${color.r}, ${color.g}, ${color.b}). From background color: ${backgroundColor}; highlight color: ${highlightColor}; and opacity: ${opacity}`,
    );

    return printRawColor(color);
}

/**
 * Same as `extrapolateHighlightColor()` but without bounds checking and using
 * `RawColor` directly. Sometimes you want an intermediate color which doesn't
 * fit in bounds of RGB.
 */
export function extrapolateHighlightRawColorWithoutBounds(
    backgroundColor: RawColor,
    highlightColor: RawColor,
    opacity: number,
): RawColor {
    const r = lerp(backgroundColor.r, highlightColor.r, 1 / opacity);
    const g = lerp(backgroundColor.g, highlightColor.g, 1 / opacity);
    const b = lerp(backgroundColor.b, highlightColor.b, 1 / opacity);
    return {r, g, b, alpha: opacity};
}
