import {InternalError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

/**
 * Helper type for manipulating the low-level representation of a color
 * in RGB format.
 *
 * We use the name `RawColor` to not conflict with the `Color` from the
 * [`color` module][1]. Long term, maybe we get rid of the `color` module and
 * replace it with our own helpers?
 *
 * [1]: https://www.npmjs.com/package/color
 */
export type RawColor = {
    r: number;
    g: number;
    b: number;
    alpha: number;
};

export function parseRawColor(color: string): RawColor {
    assert(color.startsWith("#"));

    const hex = color.slice(1);
    let r: number;
    let g: number;
    let b: number;
    let alpha: number = 1;

    if (hex.length === 3) {
        // #rgb
        r = parseInt(hex[0]! + hex[0]!, 16);
        g = parseInt(hex[1]! + hex[1]!, 16);
        b = parseInt(hex[2]! + hex[2]!, 16);
    } else if (hex.length === 4) {
        // #rgba
        r = parseInt(hex[0]! + hex[0]!, 16);
        g = parseInt(hex[1]! + hex[1]!, 16);
        b = parseInt(hex[2]! + hex[2]!, 16);
        alpha = parseInt(hex[3]! + hex[3]!, 16) / 255;
    } else if (hex.length === 6) {
        // #rrggbb
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
    } else if (hex.length === 8) {
        // #rrggbbaa
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
        alpha = parseInt(hex.slice(6, 8), 16) / 255;
    } else {
        throw new InternalError(`Invalid hex color: ${color}`);
    }

    return {r, g, b, alpha};
}

export function printRawColor(color: RawColor): string {
    const r = Math.round(clamp(0, color.r, 255));
    const g = Math.round(clamp(0, color.g, 255));
    const b = Math.round(clamp(0, color.b, 255));
    const alpha = clamp(0, color.alpha, 1);

    const rHex = r.toString(16).padStart(2, "0");
    const gHex = g.toString(16).padStart(2, "0");
    const bHex = b.toString(16).padStart(2, "0");
    const alphaHex = Math.round(alpha * 255)
        .toString(16)
        .padStart(2, "0");

    if (alpha === 1) return `#${rHex}${gHex}${bHex}`;

    return `#${rHex}${gHex}${bHex}${alphaHex}`;
}

export function mixRawColors(frontColor: RawColor, backColor: RawColor): RawColor {
    if (frontColor.alpha <= 0) return backColor;
    if (backColor.alpha <= 0) return frontColor;

    const alpha = 1 - (1 - frontColor.alpha) * (1 - backColor.alpha);

    const r = Math.round(
        (frontColor.r * frontColor.alpha) / alpha +
            (backColor.r * backColor.alpha * (1 - frontColor.alpha)) / alpha,
    );
    const g = Math.round(
        (frontColor.g * frontColor.alpha) / alpha +
            (backColor.g * backColor.alpha * (1 - frontColor.alpha)) / alpha,
    );
    const b = Math.round(
        (frontColor.b * frontColor.alpha) / alpha +
            (backColor.b * backColor.alpha * (1 - frontColor.alpha)) / alpha,
    );

    return {r, g, b, alpha};
}
