import {assignVars, createGlobalTheme, globalStyle, style} from "@vanilla-extract/css";
import assert from "assert";
import {colors} from "~/shared/design/colors";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get-or-set-default-map-value";

const colorByShadeByName = new Map<string, Map<number, string>>();

for (const [nameAndShade, color] of Object.entries(colors)) {
    const [name, shadeString] = nameAndShade.split("-", 2);
    assert(name && shadeString);
    const shade = parseInt(shadeString, 10);
    assert(!isNaN(shade));

    getOrSetDefaultMapValue(colorByShadeByName, name, () => new Map()).set(shade, color);
}

const invertedColorByShadeByName = new Map<string, Map<number, string>>();

for (const [name, colorByShade] of colorByShadeByName) {
    const invertedColorByShade = new Map<number, string>();

    const colorByShadeEntries = Array.from(colorByShade.entries()).sort(
        ([shade1], [shade2]) => shade1 - shade2,
    );

    const invertedColorByShadeEntries = colorByShadeEntries.slice().reverse();

    for (let i = 0; i < colorByShadeEntries.length; i++) {
        invertedColorByShade.set(colorByShadeEntries[i]![0], invertedColorByShadeEntries[i]![1]);
    }

    invertedColorByShadeByName.set(name, invertedColorByShade);
}

const invertedColors = Object.fromEntries<string>(
    Array.from(invertedColorByShadeByName, ([name, invertedColorByShade]) =>
        Array.from(invertedColorByShade, ([shade, color]) => [`${name}-${shade}`, color] as const),
    ).flat(),
) as {readonly [Color in keyof typeof colors]: string};

/**
 * Colors that switch dynamically between light and dark mode depending on
 * the context.
 */
export const colorSchemeVars = createGlobalTheme(":root", colors);

/**
 * The color scheme which identifies whether we are in dark mode.
 */
export const darkColorSchemeSelector = ":root[data-color-scheme=dark]";

/**
 * The color scheme which identifies whether we are in light mode.
 *
 * We define this as a `:not()` dark color scheme selector since in the rest of
 * our code we only really check the dark constant.
 */
export const lightColorSchemeSelector = ":root:not([data-color-scheme=dark])";

globalStyle(darkColorSchemeSelector, {
    vars: assignVars(colorSchemeVars, invertedColors),
});

export const hiddenIfDarkColorSchemeClassName = style({
    selectors: {
        [`${darkColorSchemeSelector} &`]: {
            display: "none",
        },
    },
});

export const hiddenIfLightColorSchemeClassName = style({
    selectors: {
        [`${lightColorSchemeSelector} &`]: {
            display: "none",
        },
    },
});
