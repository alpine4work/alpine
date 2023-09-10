import {assignVars, createGlobalTheme, globalStyle, style} from "@vanilla-extract/css";
import {Color, colors} from "~/shared/design/colors.js";
import {ThemeColor, defaultThemeColor, themeColors} from "~/shared/design/theme_colors.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

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

const colorsWithShade = Object.fromEntries<string>(
    Array.from(colorByShadeByName, ([name, colorByShade]) =>
        Array.from(colorByShade, ([shade, color]) => [`${name}-${shade}`, color] as const),
    ).flat(),
) as {readonly [C in Color & `${string}-${number}`]: `#${string}`};

const invertedColorsWithShade = Object.fromEntries<string>(
    Array.from(invertedColorByShadeByName, ([name, invertedColorByShade]) =>
        Array.from(invertedColorByShade, ([shade, color]) => [`${name}-${shade}`, color] as const),
    ).flat(),
) as {readonly [C in Color & `${string}-${number}`]: `#${string}`};

export {invertedColorsWithShade as invertedColors};

const selectionColors = Object.fromEntries(
    [...themeColors, "grey" as const].map(themeColor => {
        const selectionAlpha = 1 / 2;
        const selectionAlphaHex = Math.round(selectionAlpha * 255)
            .toString(16)
            .padStart(2, "0");

        const colorHexCode: `#${string}` = colors[`${themeColor}-20`];
        return [`${themeColor}-selection`, `${colorHexCode}${selectionAlphaHex}`];
    }),
) as {readonly [C in ThemeColor | "grey" as `${C}-selection`]: `#${string}`};

// The inverted selection color also uses the 20 shade for selection colors but
// with a lower opacity. We use the 20 shade since it's less saturated than the
// darker shades. Less saturated colors look better as selection colors.
const invertedSelectionColors = Object.fromEntries(
    [...themeColors, "grey" as const].map(themeColor => {
        const selectionAlpha = 1 / 4;
        const selectionAlphaHex = Math.round(selectionAlpha * 255)
            .toString(16)
            .padStart(2, "0");

        const colorHexCode: `#${string}` = colors[`${themeColor}-20`];
        return [`${themeColor}-selection`, `${colorHexCode}${selectionAlphaHex}`];
    }),
) as {readonly [C in ThemeColor | "grey" as `${C}-selection`]: `#${string}`};

// Copied from `@vanilla-extract/private` since TypeScript needs an annotation
// for exported variables to generate a declaration and we don't want to import
// from a private package.
export type CssVarFunction = `var(--${string})` | `var(--${string}, ${string | number})`;

/**
 * Colors that switch dynamically between light and dark mode depending on
 * the context.
 */
const baseColorSchemeVars: {
    [K in keyof typeof colorsWithShade | keyof typeof selectionColors]: CssVarFunction;
} = createGlobalTheme(":root", {
    ...colorsWithShade,
    ...selectionColors,
});

globalStyle(darkColorSchemeSelector, {
    vars: assignVars(baseColorSchemeVars, {
        ...invertedColorsWithShade,
        ...invertedSelectionColors,
    }),
});

/**
 * Constant colors don't change based on whether we are in light mode or dark
 * mode.
 *
 * They have a longer name than our variable colors since generally you should
 * prefer the variable colors.
 */
const constantColors = Object.fromEntries(
    Object.entries(colorsWithShade).map(([colorName, colorHexCode]) => [
        `${colorName}-const`,
        colorHexCode,
    ]),
) as {[C in keyof typeof colorsWithShade as `${C}-const`]: string};

function createTheme(color: ThemeColor) {
    return {
        "theme-5": baseColorSchemeVars[`${color}-5`],
        "theme-10": baseColorSchemeVars[`${color}-10`],
        "theme-20": baseColorSchemeVars[`${color}-20`],
        "theme-30": baseColorSchemeVars[`${color}-30`],
        "theme-40": baseColorSchemeVars[`${color}-40`],
        "theme-50": baseColorSchemeVars[`${color}-50`],
        "theme-60": baseColorSchemeVars[`${color}-60`],
        "theme-70": baseColorSchemeVars[`${color}-70`],
        "theme-80": baseColorSchemeVars[`${color}-80`],
        "theme-90": baseColorSchemeVars[`${color}-90`],
        "theme-selection": baseColorSchemeVars[`${color}-selection`],
        "theme-5-const": constantColors[`${color}-5-const`],
        "theme-10-const": constantColors[`${color}-10-const`],
        "theme-20-const": constantColors[`${color}-20-const`],
        "theme-30-const": constantColors[`${color}-30-const`],
        "theme-40-const": constantColors[`${color}-40-const`],
        "theme-50-const": constantColors[`${color}-50-const`],
        "theme-60-const": constantColors[`${color}-60-const`],
        "theme-70-const": constantColors[`${color}-70-const`],
        "theme-80-const": constantColors[`${color}-80-const`],
        "theme-90-const": constantColors[`${color}-90-const`],
    };
}

/**
 * Color variables that are set to some user determined theme value.
 */
// TODO(calebmer): Allow switching theme color vars based on workspace settings.
const themeColorSchemeVars: {[K in keyof ReturnType<typeof createTheme>]: CssVarFunction} =
    createGlobalTheme(":root", createTheme(defaultThemeColor));

/**
 * Special shades of grey that do not follow the inverted grey color spectrum.
 */
const specialGreyColorVars: {
    /**
     * The color of text. `grey-dark` in light mode and `grey-0` in dark mode.
     */
    "grey-text": CssVarFunction;

    /**
     * The background color behind any panels which gives the product a sense of
     * depth. In light mode, this is a darker shade of grey than our white panels.
     * In dark mode, this is a darker shade of grey than our `grey-90` panels.
     */
    "grey-wash": CssVarFunction;

    /**
     * `grey-5` in light mode and `grey-10` in dark mode (the inverted `grey-10`).
     */
    "grey-5-dark-10": CssVarFunction;
} = createGlobalTheme(":root", {
    "grey-text": colors["grey-dark"],
    "grey-wash": colors["grey-5"],
    "grey-5-dark-10": colors["grey-5"],
});

globalStyle(darkColorSchemeSelector, {
    vars: assignVars(specialGreyColorVars, {
        "grey-text": colors["grey-0"],
        "grey-wash": colors["grey-dark"],
        "grey-5-dark-10": invertedColorsWithShade["grey-10"],
    }),
});

export const colorSchemeVars = {
    // Spread `colors` first. `baseColorSchemeVars` will override most of our
    // colors but any non-shade colors (e.g. `grey-dark`) will be included as a
    // constant here.
    ...colors,
    ...baseColorSchemeVars,
    ...constantColors,
    ...themeColorSchemeVars,
    ...specialGreyColorVars,
};

/**
 * When you put this class on an element then all children will use "elevated"
 * colors. This has no effect in light mode but in dark mode elevated colors are
 * slightly lighter. Since we can't use shadows in dark mode to simulate depth we
 * instead give surfaces that are "higher up" a lighter background. We use this
 * for peeks since peeks contain arbitrary content we need to implement
 * these lighter backgrounds at the color system level.
 */
export const greyElevated1ClassName = style({
    vars: {
        [specialGreyColorVars["grey-wash"]]: colors["grey-5-elevated-1-wash"],
    },
});

globalStyle(`${darkColorSchemeSelector} ${greyElevated1ClassName}`, {
    vars: {
        [colorSchemeVars["grey-0"]]: colors["grey-90-elevated-1"],
        [colorSchemeVars["grey-5"]]: colors["grey-80-elevated-1"],
        [colorSchemeVars["grey-10"]]: colors["grey-70-elevated-1"],
        [specialGreyColorVars["grey-wash"]]: colors["grey-dark-elevated-1-wash"],
    },
});

/**
 * When you put this class on an element then all children will use "elevated"
 * colors. This has no effect in light mode but in dark mode elevated colors are
 * slightly lighter. Since we can't use shadows in dark mode to simulate depth we
 * instead give surfaces that are "higher up" a lighter background. We use this
 * for hovering overlays.
 */
export const greyElevated2ClassName = style({});

globalStyle(`${darkColorSchemeSelector} ${greyElevated2ClassName}`, {
    vars: {
        [colorSchemeVars["grey-0"]]: colors["grey-90-elevated-2"],
        [colorSchemeVars["grey-5"]]: colors["grey-80-elevated-2"],
        [colorSchemeVars["grey-10"]]: colors["grey-70-elevated-2"],
        [colorSchemeVars["grey-20"]]: colors["grey-60-elevated-2"],
    },
});
