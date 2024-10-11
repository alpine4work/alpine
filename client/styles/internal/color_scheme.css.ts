import {assignVars, createGlobalTheme, globalStyle, style} from "@vanilla-extract/css";
import {colors} from "~/shared/design/colors.js";
import {colorsWithShade, invertedColorsWithShade} from "~/shared/design/inverted_colors.js";
import {ThemeColor, defaultThemeColor, themeColors} from "~/shared/design/theme_colors.js";

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

const selectionColors = Object.fromEntries(
    [...themeColors, "grey" as const].map(themeColor => {
        const selectionAlpha = 2 / 3;
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
        const selectionAlpha = 1 / 3;
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
    [K in keyof typeof colorsWithShade]: CssVarFunction;
} = createGlobalTheme(":root", colorsWithShade);

globalStyle(darkColorSchemeSelector, {
    vars: assignVars(baseColorSchemeVars, invertedColorsWithShade),
});

const selectionColorSchemeVars: {
    [K in keyof typeof selectionColors]: CssVarFunction;
} = createGlobalTheme(":root", selectionColors);

globalStyle(darkColorSchemeSelector, {
    vars: assignVars(selectionColorSchemeVars, invertedSelectionColors),
});

const invertedSelectionColorSchemeVars: {
    [K in keyof typeof selectionColors as `${K}-inverted`]: CssVarFunction;
} = createGlobalTheme(
    ":root",
    Object.fromEntries(
        Object.entries(invertedSelectionColors).map(([key, value]) => [`${key}-inverted`, value]),
    ) as {
        [K in keyof typeof selectionColors as `${K}-inverted`]: `#${string}`;
    },
);

globalStyle(darkColorSchemeSelector, {
    vars: assignVars(
        invertedSelectionColorSchemeVars,
        Object.fromEntries(
            Object.entries(selectionColors).map(([key, value]) => [`${key}-inverted`, value]),
        ) as {
            [K in keyof typeof selectionColors as `${K}-inverted`]: `#${string}`;
        },
    ),
});

export const invertSelectionColorsClassName = style({});

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

const translucentColorSchemeVars: {
    [C in ThemeColor as `${C}-60-opacity-60` | `${C}-70-opacity-60`]: CssVarFunction;
} = createGlobalTheme(
    ":root",
    Object.fromEntries(
        themeColors.flatMap(color => [
            [`${color}-60-opacity-60`, `${colorsWithShade[`${color}-60`]}99`],
            [`${color}-70-opacity-60`, `${colorsWithShade[`${color}-70`]}99`],
        ]),
    ) as {[C in ThemeColor as `${C}-60-opacity-60` | `${C}-70-opacity-60`]: `#${string}`},
);

globalStyle(darkColorSchemeSelector, {
    vars: assignVars(
        translucentColorSchemeVars,
        Object.fromEntries(
            themeColors.flatMap(color => [
                [`${color}-60-opacity-60`, `${invertedColorsWithShade[`${color}-60`]}99`],
                [`${color}-70-opacity-60`, `${invertedColorsWithShade[`${color}-70`]}99`],
            ]),
        ) as {[C in ThemeColor as `${C}-60-opacity-60` | `${C}-70-opacity-60`]: `#${string}`},
    ),
});

function createTheme(color: ThemeColor) {
    return {
        "theme-10": baseColorSchemeVars[`${color}-10`],
        "theme-20": baseColorSchemeVars[`${color}-20`],
        "theme-30": baseColorSchemeVars[`${color}-30`],
        "theme-40": baseColorSchemeVars[`${color}-40`],
        "theme-50": baseColorSchemeVars[`${color}-50`],
        "theme-60": baseColorSchemeVars[`${color}-60`],
        "theme-70": baseColorSchemeVars[`${color}-70`],
        "theme-80": baseColorSchemeVars[`${color}-80`],
        "theme-90": baseColorSchemeVars[`${color}-90`],
        "theme-60-opacity-60": translucentColorSchemeVars[`${color}-60-opacity-60`],
        "theme-70-opacity-60": translucentColorSchemeVars[`${color}-70-opacity-60`],
        "theme-selection": selectionColorSchemeVars[`${color}-selection`],
        "theme-selection-inverted": invertedSelectionColorSchemeVars[`${color}-selection-inverted`],
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
     * `grey-5` in light mode and `grey-10` in dark mode (the inverted `grey-10`).
     */
    "grey-5-dark-10": CssVarFunction;

    /**
     * `grey-0` with 20% opacity.
     */
    "grey-0-opacity-20": CssVarFunction;

    /**
     * `grey-0` with 40% opacity.
     */
    "grey-0-opacity-40": CssVarFunction;

    /**
     * `grey-0` with 60% opacity.
     */
    "grey-0-opacity-60": CssVarFunction;

    /**
     * `grey-0` with 80% opacity.
     */
    "grey-0-opacity-80": CssVarFunction;
} = createGlobalTheme(":root", {
    "grey-5-dark-10": colors["grey-5"],
    "grey-0-opacity-20": `${colors["grey-0"]}33`,
    "grey-0-opacity-40": `${colors["grey-0"]}66`,
    "grey-0-opacity-60": `${colors["grey-0"]}99`,
    "grey-0-opacity-80": `${colors["grey-0"]}cc`,
});

globalStyle(darkColorSchemeSelector, {
    vars: assignVars(specialGreyColorVars, {
        "grey-5-dark-10": invertedColorsWithShade["grey-10"],
        "grey-0-opacity-20": `${colors["grey-90"]}33`,
        "grey-0-opacity-40": `${colors["grey-90"]}66`,
        "grey-0-opacity-60": `${colors["grey-90"]}99`,
        "grey-0-opacity-80": `${colors["grey-90"]}cc`,
    }),
});

export type ColorSchemeVar = keyof typeof colorSchemeVars;

export const colorSchemeVars = {
    // Spread `colors` first. `baseColorSchemeVars` will override most of our
    // colors but any non-shade colors (e.g. `grey-70-elevated-1`) will be included
    // as a constant here.
    ...colors,
    ...baseColorSchemeVars,
    ...selectionColorSchemeVars,
    ...invertedSelectionColorSchemeVars,
    ...constantColors,
    ...themeColorSchemeVars,
    ...specialGreyColorVars,
    ...translucentColorSchemeVars,
};

/**
 * Theme color to be used for accent elements which are typically white text
 * with the accent color as the background. These elements are relatively rare
 * and used to draw the user's eye.
 *
 * Generally, we want all uses of our theme color to have an accessible color
 * contrast but we also want to be true to the typical brand usage for a given
 * accent color. If the user cares about accessibility and has inaccessible
 * brand colors (e.g. white text on red buttons is famously inaccessible) then
 * they should pick a different accessible theme color for their organization.
 * We could also offer a high contrast mode for users that absolutely need
 * accessible color combinations.
 *
 * Known inaccessible color combinations for white text on:
 *
 * - `red-50` (light mode accent) has an inaccessible contrast of 3.58
 * - `orange-50` (light mode accent) has an inaccessible contrast of 2.91
 * - `orange-60` (dark mode accent) has an inaccessible contrast of 4.26
 * - `green-50` (light mode accent) has an inaccessible contrast of 2.91
 * - `cyan-50` (light mode accent) has an inaccessible contrast of 2.68
 * - `cyan-60` (dark mode accent) has an inaccessible contrast of 3.93
 * - `pink-50` (light mode accent) has an inaccessible contrast of 3.13
 */
export const accentThemeBackgroundColor: {light: ColorSchemeVar; dark: ColorSchemeVar} = {
    light: "theme-50-const",
    dark: "theme-60-const",
};

export const accentThemeForegroundColor: ColorSchemeVar = "grey-0-const";

/**
 * When you put this class on an element then all children will use "elevated"
 * colors. This has no effect in light mode but in dark mode elevated colors are
 * slightly lighter. Since we can't use shadows in dark mode to simulate depth we
 * instead give surfaces that are "higher up" a lighter background. We use this
 * for peeks since peeks contain arbitrary content we need to implement
 * these lighter backgrounds at the color system level.
 */
export const greyElevated1ClassName = style({});

globalStyle(`${darkColorSchemeSelector} ${greyElevated1ClassName}`, {
    vars: {
        [colorSchemeVars["grey-0"]]: colors["grey-100-elevated-1"],
        [colorSchemeVars["grey-5"]]: colors["grey-90-elevated-1"],
        [colorSchemeVars["grey-10"]]: colors["grey-80-elevated-1"],
        [colorSchemeVars["grey-20"]]: colors["grey-70-elevated-1"],
    },
});

/**
 * When you put this class on an element then all children will use "elevated"
 * colors. This has no effect in light mode but in dark mode elevated colors are
 * slightly lighter. Since we can't use shadows in dark mode to simulate depth we
 * instead give surfaces that are "higher up" a lighter background. We use this
 * for hovering overlays.
 */
export const greyElevated2ClassName = style({
    vars: {},
});

globalStyle(`${darkColorSchemeSelector} ${greyElevated2ClassName}`, {
    vars: {
        [colorSchemeVars["grey-0"]]: colors["grey-100-elevated-2"],
        [colorSchemeVars["grey-5"]]: colors["grey-90-elevated-2"],
        [colorSchemeVars["grey-10"]]: colors["grey-80-elevated-2"],
        [colorSchemeVars["grey-20"]]: colors["grey-70-elevated-2"],
        [colorSchemeVars["grey-30"]]: colors["grey-60-elevated-2"],
    },
});
