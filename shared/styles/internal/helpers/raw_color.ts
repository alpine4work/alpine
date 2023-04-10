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
