import {assignVars, createGlobalTheme, globalStyle} from "@vanilla-extract/css";
import {
    CssVarFunction,
    darkColorSchemeSelector,
} from "~/client/web/styles/core/internal/color_scheme.css.js";
import {colors} from "~/shared/design/core/colors.js";
import {
    greyElevated1ClassName,
    greyElevated2ClassName,
} from "~/shared/design/core/constant_class_names.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

/**
 * CSS box shadows used to simulate elevation in our product.
 *
 * Light mode shadows have a 1px transparent border to increase contrast. See
 * [this thread][1] for explanation on why it looks better than a solid border
 * color.
 *
 * [1]: https://twitter.com/jamesm/status/1622702890912456704
 */
export const elevation = {
    "elevation-5": createElevation({
        lightBorderColor: "rgb(0 0 0 / 0.05)",
        darkBorderColor: "grey-90",
        shadows: [
            {
                shadow: "0px 1px 2px 0px",
                lightColor: "rgb(18 18 20 / 0.05)",
                darkColor: "rgb(0 0 0 / 0.15)",
            },
        ],
    }),
    "elevation-5-without-border": createElevation({
        lightBorderColor: null,
        darkBorderColor: null,
        shadows: [
            {
                shadow: "0px 1px 2px 0px",
                lightColor: "rgb(18 18 20 / 0.05)",
                darkColor: "rgb(0 0 0 / 0.15)",
            },
        ],
    }),
    "elevation-5-with-grey-10-border": createElevation({
        lightBorderColor: "grey-10",
        darkBorderColor: "grey-80",
        shadows: [
            {
                shadow: "0px 1px 2px 0px",
                lightColor: "rgb(18 18 20 / 0.05)",
                darkColor: "rgb(0 0 0 / 0.15)",
            },
        ],
    }),
    "elevation-10": createElevation({
        lightBorderColor: "rgb(0 0 0 / 0.05)",
        darkBorderColor: "grey-90",
        shadows: [
            {
                shadow: "0px 1px 3px 0px",
                lightColor: "rgb(18 18 20 / 0.1)",
                darkColor: "rgb(0 0 0 / 0.3)",
            },
            {
                shadow: "0px 1px 2px 0px",
                lightColor: "rgb(18 18 20 / 0.06)",
                darkColor: "rgb(0 0 0 / 0.18)",
            },
        ],
    }),
    "elevation-20": createElevation({
        lightBorderColor: "rgb(0 0 0 / 0.09)",
        darkBorderColor: "grey-80",
        shadows: [
            {
                shadow: "0px 4px 8px -2px",
                lightColor: "rgb(18 18 20 / 0.12)",
                darkColor: "rgb(0 0 0 / 0.3)",
            },
            {
                shadow: "0px 2px 4px -2px",
                lightColor: "rgb(18 18 20 / 0.06)",
                darkColor: "rgb(0 0 0 / 0.18)",
            },
        ],
    }),
    "elevation-20-with-grey-10-border": createElevation({
        lightBorderColor: "grey-10",
        darkBorderColor: "grey-80",
        shadows: [
            {
                shadow: "0px 4px 8px -2px",
                lightColor: "rgb(18 18 20 / 0.12)",
                darkColor: "rgb(0 0 0 / 0.3)",
            },
            {
                shadow: "0px 2px 4px -2px",
                lightColor: "rgb(18 18 20 / 0.06)",
                darkColor: "rgb(0 0 0 / 0.18)",
            },
        ],
    }),
    "elevation-20-above-content-file-viewer-modal": createElevation({
        lightBorderColor: null,
        darkBorderColor: null,
        shadows: [
            {
                shadow: "0px 4px 8px -2px",
                lightColor: "rgb(18 18 20 / 0.12)",
                darkColor: "rgb(0 0 0 / 0.15)",
            },
            {
                shadow: "0px 2px 4px -2px",
                lightColor: "rgb(18 18 20 / 0.06)",
                darkColor: "rgb(0 0 0 / 0.09)",
            },
        ],
    }),
    "elevation-30": createElevation({
        lightBorderColor: "rgb(0 0 0 / 0.09)",
        darkBorderColor: "grey-80",
        shadows: [
            {
                shadow: "0px 12px 16px -4px",
                lightColor: "rgb(18 18 20 / 0.12)",
                darkColor: "rgb(0 0 0 / 0.24)",
            },
            {
                shadow: "0px 4px 6px -2px",
                lightColor: "rgb(18 18 20 / 0.03)",
                darkColor: "rgb(0 0 0 / 0.09)",
            },
        ],
    }),
    "elevation-30-with-grey-10-border": createElevation({
        lightBorderColor: "grey-10",
        darkBorderColor: "grey-80",
        shadows: [
            {
                shadow: "0px 12px 16px -4px",
                lightColor: "rgb(18 18 20 / 0.12)",
                darkColor: "rgb(0 0 0 / 0.24)",
            },
            {
                shadow: "0px 4px 6px -2px",
                lightColor: "rgb(18 18 20 / 0.03)",
                darkColor: "rgb(0 0 0 / 0.09)",
            },
        ],
    }),
    "elevation-30-inset": createElevation({
        inset: true,
        lightBorderColor: "rgb(0 0 0 / 0.09)",
        darkBorderColor: "grey-80",
        shadows: [
            {
                shadow: "0px 12px 16px -4px",
                lightColor: "rgb(18 18 20 / 0.12)",
                darkColor: "rgb(0 0 0 / 0.24)",
            },
            {
                shadow: "0px 4px 6px -2px",
                lightColor: "rgb(18 18 20 / 0.03)",
                darkColor: "rgb(0 0 0 / 0.09)",
            },
        ],
    }),
    "elevation-40": createElevation({
        lightBorderColor: "rgb(0 0 0 / 0.09)",
        darkBorderColor: "grey-80",
        shadows: [
            {
                shadow: "0px 20px 24px -4px",
                lightColor: "rgb(18 18 20 / 0.12)",
                darkColor: "rgb(0 0 0 / 0.24)",
            },
            {
                shadow: "0px 8px 8px -4px",
                lightColor: "rgb(18 18 20 / 0.03)",
                darkColor: "rgb(0 0 0 / 0.09)",
            },
        ],
    }),
    "elevation-40-from-bottom": createElevation({
        lightBorderColor: "rgb(0 0 0 / 0.09)",
        darkBorderColor: "grey-80",
        shadows: [
            {
                shadow: "0px 5px 24px -4px",
                lightColor: "rgb(18 18 20 / 0.12)",
                darkColor: "rgb(0 0 0 / 0.24)",
            },
            {
                shadow: "0px 2px 8px -4px",
                lightColor: "rgb(18 18 20 / 0.03)",
                darkColor: "rgb(0 0 0 / 0.09)",
            },
        ],
    }),
    "elevation-50": createElevation({
        lightBorderColor: "rgb(0 0 0 / 0.09)",
        darkBorderColor: "grey-80",
        shadows: [
            {
                shadow: "0px 24px 48px -12px",
                lightColor: "rgb(18 18 20 / 0.20)",
                darkColor: "rgb(0 0 0 / 0.46)",
            },
        ],
    }),
    "elevation-60": createElevation({
        lightBorderColor: "rgb(0 0 0 / 0.09)",
        darkBorderColor: "grey-80",
        shadows: [
            {
                shadow: "0px 32px 64px -12px",
                lightColor: "rgb(18 18 20 / 0.15)",
                darkColor: "rgb(0 0 0 / 0.38)",
            },
        ],
    }),
};

function createElevation({
    inset,
    lightBorderColor,
    darkBorderColor,
    shadows,
}: {
    inset?: boolean;
    lightBorderColor: `rgb(${string})` | "grey-10" | null;
    darkBorderColor: "grey-70" | "grey-80" | "grey-90" | null;
    shadows: Array<{shadow: string; lightColor: string; darkColor: string}>;
}) {
    const lightBoxShadows: Array<string> = [];
    const darkBoxShadows: Array<string> = [];
    const darkElevated1BoxShadows: Array<string> = [];
    const darkElevated2BoxShadows: Array<string> = [];

    // If we are intentionally using a solid border color for our light border then
    // we want to render the shadow like we would an actual border, inset in
    // the box.
    const borderInset = lightBorderColor === "grey-10" || inset ? "inset " : "";

    if (lightBorderColor !== null) {
        if (lightBorderColor === "grey-10") {
            lightBoxShadows.push(`${borderInset}0 0 0 1px ${colors[lightBorderColor]}`);
        } else {
            lightBoxShadows.push(`${borderInset}0 0 0 1px ${lightBorderColor}`);
        }
    }

    if (darkBorderColor !== null) {
        darkBoxShadows.push(`${borderInset}0 0 0 1px ${colors[darkBorderColor]}`);
        darkElevated1BoxShadows.push(
            `${borderInset}0 0 0 1px ${colors[`${darkBorderColor}-elevated-1`]}`,
        );
        darkElevated2BoxShadows.push(
            `${borderInset}0 0 0 1px ${colors[`${darkBorderColor}-elevated-2`]}`,
        );
    }

    const shadowInset = inset ? "inset " : "";

    for (const {shadow, lightColor, darkColor} of shadows) {
        lightBoxShadows.push(`${shadowInset}${shadow} ${lightColor}`);
        darkBoxShadows.push(`${shadowInset}${shadow} ${darkColor}`);
        darkElevated1BoxShadows.push(`${shadowInset}${shadow} ${darkColor}`);
        darkElevated2BoxShadows.push(`${shadowInset}${shadow} ${darkColor}`);
    }

    return {
        light: lightBoxShadows.join(", "),
        dark: darkBoxShadows.join(", "),
        darkElevated1: darkElevated1BoxShadows.join(", "),
        darkElevated2: darkElevated2BoxShadows.join(", "),
    };
}

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

globalStyle(`${darkColorSchemeSelector} ${greyElevated1ClassName}`, {
    vars: assignVars(
        elevationVars,
        mapObjectValues(elevation, ({darkElevated1}) => darkElevated1),
    ),
});

globalStyle(`${darkColorSchemeSelector} ${greyElevated2ClassName}`, {
    vars: assignVars(
        elevationVars,
        mapObjectValues(elevation, ({darkElevated2}) => darkElevated2),
    ),
});
