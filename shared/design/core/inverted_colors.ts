import {Color, colors} from "~/shared/design/core/colors.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

export type ColorWithShade = Color & `${string}-${number}`;

const colorByShadeByName = new Map<string, Map<number, string>>();

for (const [nameAndShade, color] of Object.entries(colors)) {
    const shadeStartIndex = nameAndShade.indexOf("-");
    assert(shadeStartIndex >= 0);
    const name = nameAndShade.slice(0, shadeStartIndex);
    const shadeString = nameAndShade.slice(shadeStartIndex + 1);
    assert(name && shadeString);
    const shade = parseInt(shadeString, 10);

    // Ignore colors which do not have a shade number.
    if (!/^\d+$/.test(shadeString) || isNaN(shade)) continue;

    getOrSetDefaultMapValue(colorByShadeByName, name, () => new Map()).set(shade, color);
}

const invertedColorByShadeByName = new Map<string, Map<number, string>>();
const invertedColorShadeByShadeByName = new Map<string, Map<number, number>>();

for (const [name, colorByShade] of colorByShadeByName) {
    const invertedColorByShade = new Map<number, string>();
    const invertedColorShadeByShade = new Map<number, number>();

    const colorByShadeEntries = Array.from(colorByShade.entries()).sort(
        ([shade1], [shade2]) => shade1 - shade2,
    );

    const invertedColorByShadeEntries = colorByShadeEntries.slice().reverse();

    for (let i = 0; i < colorByShadeEntries.length; i++) {
        invertedColorByShade.set(colorByShadeEntries[i]![0], invertedColorByShadeEntries[i]![1]);
        invertedColorShadeByShade.set(
            colorByShadeEntries[i]![0],
            invertedColorByShadeEntries[i]![0],
        );
    }

    invertedColorByShadeByName.set(name, invertedColorByShade);
    invertedColorShadeByShadeByName.set(name, invertedColorShadeByShade);
}

/**
 * The hexadecimal color for each `ColorWithShade`. The same as `colors` but with
 * non-`ColorWithShade` colors removed.
 */
export const colorsWithShade = Object.fromEntries<string>(
    Array.from(colorByShadeByName, ([name, colorByShade]) =>
        Array.from(colorByShade, ([shade, color]) => [`${name}-${shade}`, color] as const),
    ).flat(),
) as {readonly [C in ColorWithShade]: `#${string}`};

/**
 * The inverted hexadecimal color for each `ColorWithShade`. By default when we
 * switch to dark mode all colors invert.
 */
export const invertedColorsWithShade = Object.fromEntries<string>(
    Array.from(invertedColorByShadeByName, ([name, invertedColorByShade]) =>
        Array.from(invertedColorByShade, ([shade, color]) => [`${name}-${shade}`, color] as const),
    ).flat(),
) as {readonly [C in ColorWithShade]: `#${string}`};

/**
 * Return the inverted `ColorWithShade` for the provided `ColorWithShade`.
 */
export function invertColor(color: ColorWithShade): ColorWithShade {
    const [name = "", shadeString = ""] = color.split("-", 2);
    const shade = parseInt(shadeString, 10);
    return `${name}-${assertExists(
        invertedColorShadeByShadeByName.get(name)?.get(shade),
    )}` as ColorWithShade;
}

/**
 * Is this color considered a light color? Light colors are any color with a shade
 * less than or equal to 40.
 */
export function isLightColor(color: ColorWithShade): boolean {
    const [, shadeString = ""] = color.split("-", 2);
    const shade = parseInt(shadeString, 10);
    return shade <= 40;
}
