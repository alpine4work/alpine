import {assignVars, createGlobalTheme, createVar, globalStyle, style} from "@vanilla-extract/css";
import {colors} from "~/shared/design/core/colors.js";
import {
    greyElevated1ClassName,
    greyElevated2ClassName,
} from "~/shared/design/core/constant_class_names.js";
import {
    approximateOpacityForShiftingGreyColor,
    getColorForShiftingGreyColor,
} from "~/shared/design/core/helpers/get_color_for_shifting_grey_color.js";
import {colorsWithShade, invertedColorsWithShade} from "~/shared/design/core/inverted_colors.js";
import {ThemeColor, defaultThemeColor, themeColors} from "~/shared/design/core/theme_colors.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * The color scheme which identifies whether we are in dark mode.
 */
export const darkColorSchemeSelector = ":root[data-color=dark]";

/**
 * The color scheme which identifies whether we are in light mode.
 *
 * We define this as a `:not()` dark color scheme selector since in the rest of
 * our code we only really check the dark constant.
 */
export const lightColorSchemeSelector = ":root:not([data-color=dark])";

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

export const initialSelectionColorsClassName = style({});
export const invertSelectionColorsClassName = style({});
export const invertLightSelectionColorsClassName = style({});
export const invertDarkSelectionColorsClassName = style({});

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

const themeColorWithOpacitySchemeVars: {
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
        themeColorWithOpacitySchemeVars,
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
        "theme-60-opacity-60": themeColorWithOpacitySchemeVars[`${color}-60-opacity-60`],
        "theme-70-opacity-60": themeColorWithOpacitySchemeVars[`${color}-70-opacity-60`],
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
        "theme-40-const-opacity-60": `${constantColors[`${color}-40-const`]}99`,
        "theme-60-const-opacity-60": `${constantColors[`${color}-60-const`]}99`,
    };
}

/**
 * Color variables that are set to some user determined theme value.
 */
// TODO(calebmer): Allow switching theme color vars based on workspace settings.
const themeColorSchemeVars: {[K in keyof ReturnType<typeof createTheme>]: CssVarFunction} =
    createGlobalTheme(":root", createTheme(defaultThemeColor));

const grey1TranslucentColor = getColorForShiftingGreyColor(0.1, "1", "0");
const grey5TranslucentColor = getColorForShiftingGreyColor(0.1, "5", "0");
const grey10TranslucentColor = getColorForShiftingGreyColor(0.1, "10", "0");
const grey30TranslucentColor = getColorForShiftingGreyColor(0.1, "30", "0");
const grey40TranslucentColor = getColorForShiftingGreyColor(0.1, "40", "0");

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

    /**
     * `grey-0` with 90% opacity.
     */
    "grey-0-opacity-90": CssVarFunction;

    /**
     * `grey-10` with 80% opacity.
     */
    "grey-10-opacity-80": CssVarFunction;

    /**
     * `grey-70` with 80% opacity.
     */
    "grey-70-opacity-80": CssVarFunction;

    /**
     * When rendered over `grey-0` produces the color `grey-1`. Useful when you
     * want the color `grey-1` on a white background but over some colorful
     * content you want the color to show through.
     */
    "grey-1-translucent": CssVarFunction;

    /**
     * When rendered over `grey-0` produces the color `grey-5`. Useful when you
     * want the color `grey-5` on a white background but over some colorful
     * content you want the color to show through.
     */
    "grey-5-translucent": CssVarFunction;

    /**
     * When rendered over `grey-0` produces the color `grey-10`. Useful when you
     * want the color `grey-10` on a white background but over some colorful
     * content you want the color to show through.
     */
    "grey-10-translucent": CssVarFunction;

    /**
     * When rendered over `grey-0` produces the color `grey-30`. Useful when you
     * want the color `grey-30` on a white background but over some colorful
     * content you want the color to show through.
     */
    "grey-30-translucent": CssVarFunction;

    /**
     * When rendered over `grey-0` produces the color `grey-40`. Useful when you
     * want the color `grey-40` on a white background but over some colorful
     * content you want the color to show through.
     */
    "grey-40-translucent": CssVarFunction;
} = createGlobalTheme(":root", {
    "grey-5-dark-10": colors["grey-5"],
    "grey-0-opacity-20": `${colors["grey-0"]}${opacityHex(0.2)}`,
    "grey-0-opacity-40": `${colors["grey-0"]}${opacityHex(0.4)}`,
    "grey-0-opacity-60": `${colors["grey-0"]}${opacityHex(0.6)}`,
    "grey-0-opacity-80": `${colors["grey-0"]}${opacityHex(0.8)}`,
    "grey-0-opacity-90": `${colors["grey-0"]}${opacityHex(0.9)}`,
    "grey-10-opacity-80": `${colors["grey-10"]}${opacityHex(0.8)}`,
    "grey-70-opacity-80": `${colors["grey-70"]}${opacityHex(0.8)}`,
    "grey-1-translucent": grey1TranslucentColor.light,
    "grey-5-translucent": grey5TranslucentColor.light,
    "grey-10-translucent": grey10TranslucentColor.light,
    "grey-30-translucent": grey30TranslucentColor.light,
    "grey-40-translucent": grey40TranslucentColor.light,
});

globalStyle(darkColorSchemeSelector, {
    vars: assignVars(specialGreyColorVars, {
        "grey-5-dark-10": invertedColorsWithShade["grey-10"],
        "grey-0-opacity-20": `${invertedColorsWithShade["grey-0"]}${opacityHex(0.2)}`,
        "grey-0-opacity-40": `${invertedColorsWithShade["grey-0"]}${opacityHex(0.4)}`,
        "grey-0-opacity-60": `${invertedColorsWithShade["grey-0"]}${opacityHex(0.6)}`,
        "grey-0-opacity-80": `${invertedColorsWithShade["grey-0"]}${opacityHex(0.8)}`,
        "grey-0-opacity-90": `${invertedColorsWithShade["grey-0"]}${opacityHex(0.9)}`,
        "grey-10-opacity-80": `${invertedColorsWithShade["grey-10"]}${opacityHex(0.8)}`,
        "grey-70-opacity-80": `${invertedColorsWithShade["grey-70"]}${opacityHex(0.8)}`,
        "grey-1-translucent": grey1TranslucentColor.dark,
        "grey-5-translucent": grey5TranslucentColor.dark,
        "grey-10-translucent": grey10TranslucentColor.dark,
        "grey-30-translucent": grey30TranslucentColor.dark,
        "grey-40-translucent": grey40TranslucentColor.dark,
    }),
});

function opacityHex(opacity: number) {
    assert(0 <= opacity && opacity <= 1);

    return Math.round(opacity * 255)
        .toString(16)
        .padStart(2, "0");
}

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
    ...themeColorWithOpacitySchemeVars,
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

globalStyle(`${darkColorSchemeSelector} ${greyElevated1ClassName}`, {
    vars: {
        [colorSchemeVars["grey-0"]]: colors["grey-100-elevated-1"],
        [colorSchemeVars["grey-1"]]: colors["grey-99-elevated-1"],
        [colorSchemeVars["grey-5"]]: colors["grey-90-elevated-1"],
        [colorSchemeVars["grey-10"]]: colors["grey-80-elevated-1"],
        [colorSchemeVars["grey-20"]]: colors["grey-70-elevated-1"],
    },
});

globalStyle(`${darkColorSchemeSelector} ${greyElevated2ClassName}`, {
    vars: {
        [colorSchemeVars["grey-0"]]: colors["grey-100-elevated-2"],
        [colorSchemeVars["grey-1"]]: colors["grey-99-elevated-2"],
        [colorSchemeVars["grey-5"]]: colors["grey-90-elevated-2"],
        [colorSchemeVars["grey-10"]]: colors["grey-80-elevated-2"],
        [colorSchemeVars["grey-20"]]: colors["grey-70-elevated-2"],
        [colorSchemeVars["grey-30"]]: colors["grey-60-elevated-2"],
    },
});

const grey100ToGrey80Opacity = approximateOpacityForShiftingGreyColor("100", "80", "0");

export const grey100ToGrey80OpacityVar = createVar("grey-100-to-grey-80-opacity");

globalStyle(":root", {
    vars: {
        [grey100ToGrey80OpacityVar]: `${grey100ToGrey80Opacity.light}`,
    },
});

globalStyle(darkColorSchemeSelector, {
    vars: {
        [grey100ToGrey80OpacityVar]: `${grey100ToGrey80Opacity.dark}`,
    },
});
