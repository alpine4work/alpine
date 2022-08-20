import {assignVars, createGlobalTheme, globalStyle, style} from "@vanilla-extract/css";
import assert from "assert";
import {colors} from "~/shared/design/colors";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get-or-set-default-map-value";

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

// Make sure browser UI is using the right styles. For example, text selection
// color changes on MacOS with the color scheme.
globalStyle(":root", {colorScheme: "light"});
globalStyle(darkColorSchemeSelector, {colorScheme: "dark"});

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
const baseColorSchemeVars = createGlobalTheme(":root", colors);

globalStyle(darkColorSchemeSelector, {
    vars: assignVars(baseColorSchemeVars, invertedColors),
});

/**
 * Constant colors don't change based on whether we are in light mode or dark
 * mode.
 *
 * They have a longer name than our variable colors since generally you should
 * prefer the variable colors.
 */
const constantColors = Object.fromEntries(
    Object.entries(colors).map(([shade, color]) => [`${shade}-const`, color]),
) as {[Shade in keyof typeof colors as `${Shade}-const`]: typeof colors[Shade]};

/**
 * Color variables that are set to some user determined theme value.
 */
// TODO(calebmer): Allow switching theme color vars based on space settings.
const themeColorSchemeVars = createGlobalTheme(":root", {
    "theme-5": baseColorSchemeVars["indigo-5"],
    "theme-10": baseColorSchemeVars["indigo-10"],
    "theme-20": baseColorSchemeVars["indigo-20"],
    "theme-30": baseColorSchemeVars["indigo-30"],
    "theme-40": baseColorSchemeVars["indigo-40"],
    "theme-50": baseColorSchemeVars["indigo-50"],
    "theme-60": baseColorSchemeVars["indigo-60"],
    "theme-70": baseColorSchemeVars["indigo-70"],
    "theme-80": baseColorSchemeVars["indigo-80"],
    "theme-90": baseColorSchemeVars["indigo-90"],
    "theme-5-const": constantColors["indigo-5-const"],
    "theme-10-const": constantColors["indigo-10-const"],
    "theme-20-const": constantColors["indigo-20-const"],
    "theme-30-const": constantColors["indigo-30-const"],
    "theme-40-const": constantColors["indigo-40-const"],
    "theme-50-const": constantColors["indigo-50-const"],
    "theme-60-const": constantColors["indigo-60-const"],
    "theme-70-const": constantColors["indigo-70-const"],
    "theme-80-const": constantColors["indigo-80-const"],
    "theme-90-const": constantColors["indigo-90-const"],
});

export const colorSchemeVars = {
    ...baseColorSchemeVars,
    ...constantColors,
    ...themeColorSchemeVars,
};
