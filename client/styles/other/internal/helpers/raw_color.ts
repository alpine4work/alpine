import Color from "color";

/**
 * Helper type for manipulating the low-level representation of a color
 * in RGB format.
 */
export type RawColor = {
    r: number;
    g: number;
    b: number;
    alpha: number;
};

export function parseRawColor(color: string): RawColor {
    const rawColor = Color(color).object() as RawColor;
    rawColor.alpha ??= 1;
    return rawColor;
}

export function printRawColor(color: RawColor): string {
    return Color(color).hexa();
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
