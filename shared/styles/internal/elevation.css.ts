import {assignVars, createGlobalTheme, globalStyle} from "@vanilla-extract/css";
import {colors} from "~/shared/design/colors.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {
    CssVarFunction,
    darkColorSchemeSelector,
    greyElevatedClassName,
} from "~/shared/styles/internal/color_scheme.css.js";

/**
 * CSS box shadows used to simulate elevation in our product.
 *
 * Light mode shadows have a 1px transparent border to increase contrast. See
 * [this thread][1] for explanation on why it looks better than a solid border
 * color.
 *
 * [1]: https://twitter.com/jamesm/status/1622702890912456704
 */
const elevation = {
    "elevation-5": {
        light: "0px 1px 2px 0px rgb(18 18 20 / 0.05), 0 0 0 1px rgb(0 0 0 / 0.05)",
        dark: `0 0 0 1px ${colors["grey-80"]}, 0px 1px 2px 0px rgb(0 0 0 / 0.15)`,
        darkElevated: `0 0 0 1px ${colors["grey-80-elevated"]}, 0px 1px 2px 0px rgb(0 0 0 / 0.15)`,
    },
    "elevation-10": {
        light: "0px 1px 3px 0px rgb(18 18 20 / 0.1), 0px 1px 2px 0px rgb(18 18 20 / 0.06), 0 0 0 1px rgb(0 0 0 / 0.05)",
        dark: `0 0 0 1px ${colors["grey-80"]}, 0px 1px 3px 0px rgb(0 0 0 / 0.3), 0px 1px 2px 0px rgb(0 0 0 / 0.18)`,
        darkElevated: `0 0 0 1px ${colors["grey-80-elevated"]}, 0px 1px 3px 0px rgb(0 0 0 / 0.3), 0px 1px 2px 0px rgb(0 0 0 / 0.18)`,
    },
    "elevation-20": {
        light: "0px 4px 8px -2px rgb(18 18 20 / 0.1), 0px 2px 4px -2px rgb(18 18 20 / 0.06), 0 0 0 1px rgb(0 0 0 / 0.08)",
        dark: `0 0 0 1px ${colors["grey-70"]}, 0px 4px 8px -2px rgb(0 0 0 / 0.3), 0px 2px 4px -2px rgb(0 0 0 / 0.18)`,
        darkElevated: `0 0 0 1px ${colors["grey-70-elevated"]}, 0px 4px 8px -2px rgb(0 0 0 / 0.3), 0px 2px 4px -2px rgb(0 0 0 / 0.18)`,
    },
    "elevation-30": {
        light: "0px 12px 16px -4px rgb(18 18 20 / 0.08), 0px 4px 6px -2px rgb(18 18 20 / 0.03), 0 0 0 1px rgb(0 0 0 / 0.08)",
        dark: `0 0 0 1px ${colors["grey-70"]}, 0px 12px 16px -4px rgb(0 0 0 / 0.24), 0px 4px 6px -2px rgb(0 0 0 / 0.09)`,
        darkElevated: `0 0 0 1px ${colors["grey-70-elevated"]}, 0px 12px 16px -4px rgb(0 0 0 / 0.24), 0px 4px 6px -2px rgb(0 0 0 / 0.09)`,
    },
    "elevation-40": {
        light: "0px 20px 24px -4px rgb(18 18 20 / 0.08), 0px 8px 8px -4px rgb(18 18 20 / 0.03), 0 0 0 1px rgb(0 0 0 / 0.08)",
        dark: `0 0 0 1px ${colors["grey-70"]}, 0px 20px 24px -4px rgb(0 0 0 / 0.24), 0px 8px 8px -4px rgb(0 0 0 / 0.09)`,
        darkElevated: `0 0 0 1px ${colors["grey-70-elevated"]}, 0px 20px 24px -4px rgb(0 0 0 / 0.24), 0px 8px 8px -4px rgb(0 0 0 / 0.09)`,
    },
    "elevation-40-with-dark-color-scheme-lighter-border": {
        light: "0px 20px 24px -4px rgb(18 18 20 / 0.08), 0px 8px 8px -4px rgb(18 18 20 / 0.03), 0 0 0 1px rgb(0 0 0 / 0.08)",
        dark: `0 0 0 1px ${colors["grey-70"]}, 0px 20px 24px -4px rgb(0 0 0 / 0.24), 0px 8px 8px -4px rgb(0 0 0 / 0.09)`,
        darkElevated: `0 0 0 1px ${colors["grey-70-elevated"]}, 0px 20px 24px -4px rgb(0 0 0 / 0.24), 0px 8px 8px -4px rgb(0 0 0 / 0.09)`,
    },
    "elevation-50": {
        light: "0px 24px 48px -12px rgb(18 18 20 / 0.18), 0 0 0 1px rgb(0 0 0 / 0.08)",
        dark: `0 0 0 1px ${colors["grey-70"]}, 0px 24px 48px -12px rgb(0 0 0 / 0.46)`,
        darkElevated: `0 0 0 1px ${colors["grey-70-elevated"]}, 0px 24px 48px -12px rgb(0 0 0 / 0.46)`,
    },
    "elevation-60": {
        light: "0px 32px 64px -12px rgb(18 18 20 / 0.14), 0 0 0 1px rgb(0 0 0 / 0.08)",
        dark: `0 0 0 1px ${colors["grey-70"]}, 0px 32px 64px -12px rgb(0 0 0 / 0.38)`,
        darkElevated: `0 0 0 1px ${colors["grey-70-elevated"]}, 0px 32px 64px -12px rgb(0 0 0 / 0.38)`,
    },
} as const;

/**
 * Box shadow variables that change based on whether we're in light mode or
 * dark mode.
 */
export const elevationVars: {[K in keyof typeof elevation]: CssVarFunction} = createGlobalTheme(
    ":root",
    mapObjectValues(elevation, ({light}): string => light),
);

globalStyle(darkColorSchemeSelector, {
    vars: assignVars(
        elevationVars,
        mapObjectValues(elevation, ({dark}) => dark),
    ),
});

globalStyle(`${darkColorSchemeSelector} ${greyElevatedClassName}`, {
    vars: assignVars(
        elevationVars,
        mapObjectValues(elevation, ({darkElevated}) => darkElevated),
    ),
});
