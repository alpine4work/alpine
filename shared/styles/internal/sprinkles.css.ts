/**
 * We use [vanilla extract's sprinkles][1] library to create our own atomic
 * CSS system.
 *
 * Our choice of which properties to include and which values is mostly taken
 * from [tailwindcss][2].
 *
 * [1]: https://vanilla-extract.style/documentation/sprinkles-api
 * [2]: https://tailwindcss.com
 */

import {createSprinkles, defineProperties} from "@vanilla-extract/sprinkles";
import {mobilePlatformMediaQuery, spacing} from "~/shared/design/spacing";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values";
import {
    colorSchemeVars,
    darkColorSchemeSelector,
    elevationVars,
    lightColorSchemeSelector,
} from "~/shared/styles/internal/color_scheme.css";
import {fontSizes, fontStyles} from "~/shared/styles/internal/fonts.css";

const borderRadiuses = {
    none: "0rem",
    sm: "0.125rem",
    base: "0.25rem",
    md: "0.375rem",
    xl: "0.75rem",
    full: "9999px",
} as const;

const properties = defineProperties({
    properties: {
        overflow: {auto: "auto", hidden: "hidden", visible: "visible", scroll: "scroll"},
        overflowX: {auto: "auto", hidden: "hidden", visible: "visible", scroll: "scroll"},
        overflowY: {auto: "auto", hidden: "hidden", visible: "visible", scroll: "scroll"},
        position: {
            static: "static",
            relative: "relative",
            absolute: "absolute",
            fixed: "fixed",
            sticky: "sticky",
        },
        zIndex: {
            "0": 0,
            "10": 10,
            "20": 20,
            "30": 30,
            "40": 40,
            "50": 50,
            "-10": -10,
            "-20": -20,
            "-30": -30,
            "-40": -40,
            "-50": -50,
        },
        cursor: {
            auto: "auto",
            default: "default",
            pointer: "pointer",
            text: "text",
            move: "move",
            grab: "grab",
            grabbing: "grabbing",
            "col-resize": "col-resize",
            "row-resize": "row-resize",
        },
        pointerEvents: {auto: "auto", none: "none"},
        userSelect: {auto: "auto", none: "none", text: "text", all: "all"},
        borderRadius: borderRadiuses,
        borderTopLeftRadius: borderRadiuses,
        borderTopRightRadius: borderRadiuses,
        borderBottomLeftRadius: borderRadiuses,
        borderBottomRightRadius: borderRadiuses,
        boxShadow: elevationVars,
        textAlign: {left: "left", center: "center", right: "right", justify: "justify"},
        fontSize: fontSizes,
        fontStyle: fontStyles,
    },
    shorthands: {
        borderTopRadius: ["borderTopLeftRadius", "borderTopRightRadius"],
        borderBottomRadius: ["borderBottomLeftRadius", "borderBottomRightRadius"],
        borderLeftRadius: ["borderTopLeftRadius", "borderBottomLeftRadius"],
        borderRightRadius: ["borderTopRightRadius", "borderBottomRightRadius"],
    },
});

const spacingWithPercentages = {
    ...spacing,
    full: "100%",
    "1/2": "50%",
    "1/3": "33.333333%",
    "2/3": "66.666667%",
    "1/4": "25%",
    "2/4": "50%",
    "3/4": "75%",
    "1/5": "20%",
    "2/5": "40%",
    "3/5": "60%",
    "4/5": "80%",
    "1/6": "16.666667%",
    "2/6": "33.333333%",
    "3/6": "50%",
    "4/6": "66.666667%",
    "5/6": "83.333333%",
    "1/12": "8.333333%",
    "2/12": "16.666667%",
    "3/12": "25%",
    "4/12": "33.333333%",
    "5/12": "41.666667%",
    "6/12": "50%",
    "7/12": "58.333333%",
    "8/12": "66.666667%",
    "9/12": "75%",
    "10/12": "83.333333%",
    "11/12": "91.666667%",
};

const spacingWithNegatives = {
    ...spacing,
    ...(Object.fromEntries(
        Object.entries(spacing).map(([key, value]) => [`-${key}`, `-${value}`]),
    ) as any as {
        [K in keyof typeof spacing as `-${K}`]: `-${typeof spacing[K]}`;
    }),
};

const responsiveProperties = defineProperties({
    conditions: {
        mobile: {"@media": mobilePlatformMediaQuery},
        desktop: {},
    },
    defaultCondition: "desktop",
    properties: {
        display: {
            none: "none",
            block: "block",
            "inline-block": "inline-block",
            inline: "inline",
            flex: "flex",
            "inline-flex": "inline-flex",
        },
        top: spacingWithNegatives,
        bottom: spacingWithNegatives,
        left: spacingWithNegatives,
        right: spacingWithNegatives,
        flexDirection: {
            row: "row",
            "row-reverse": "row-reverse",
            column: "column",
            "column-reverse": "column-reverse",
        },
        flexWrap: {wrap: "wrap", "wrap-reverse": "wrap-reverse", nowrap: "nowrap"},
        flex: {
            1: "1 1 0%",
            auto: "1 1 auto",
            initial: "0 1 auto",
            none: "none",
        },
        flexGrow: {"1": 1, "0": 0},
        flexShrink: {"1": 1, "0": 0},
        justifyContent: {
            "flex-start": "flex-start",
            "flex-end": "flex-end",
            center: "center",
            "space-between": "space-between",
            "space-around": "space-around",
            "space-evenly": "space-evenly",
        },
        alignItems: {
            "flex-start": "flex-start",
            "flex-end": "flex-end",
            center: "center",
            stretch: "stretch",
            baseline: "baseline",
        },
        alignSelf: {
            auto: "auto",
            "flex-start": "flex-start",
            "flex-end": "flex-end",
            center: "center",
            stretch: "stretch",
            baseline: "baseline",
        },
        gap: spacing,
        paddingTop: spacing,
        paddingBottom: spacing,
        paddingLeft: spacing,
        paddingRight: spacing,
        marginTop: {...spacingWithNegatives, auto: "auto"},
        marginBottom: {...spacingWithNegatives, auto: "auto"},
        marginLeft: {...spacingWithNegatives, auto: "auto"},
        marginRight: {...spacingWithNegatives, auto: "auto"},
        width: spacingWithPercentages,
        minWidth: spacingWithPercentages,
        maxWidth: spacingWithPercentages,
        height: spacingWithPercentages,
        minHeight: spacingWithPercentages,
        maxHeight: spacingWithPercentages,
    },
    shorthands: {
        inset: ["top", "bottom", "left", "right"],
        padding: ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"],
        paddingX: ["paddingLeft", "paddingRight"],
        paddingY: ["paddingTop", "paddingBottom"],
        margin: ["marginTop", "marginBottom", "marginLeft", "marginRight"],
        marginX: ["marginLeft", "marginRight"],
        marginY: ["marginTop", "marginBottom"],
    },
});

const colorSchemeVarsWithTransparent = {...colorSchemeVars, transparent: "transparent"};

const colorProperties = defineProperties({
    conditions: {
        default: {},
        light: {selector: `${lightColorSchemeSelector} &`},
        dark: {selector: `${darkColorSchemeSelector} &`},

        // We do not have `:hover` styles because the `:hover` selector is emulated on
        // mobile devices. Instead use `useHover()` from `react-aria` for hover styles.
        //
        // For more details see:
        // https://react-spectrum.adobe.com/blog/building-a-button-part-2.html
    },
    defaultCondition: "default",
    properties: {
        color: colorSchemeVars,
        backgroundColor: colorSchemeVarsWithTransparent,

        // Default to thin 1px borders over chunky borders.
        border: mapObjectValues(
            colorSchemeVarsWithTransparent,
            colorSchemeVar => `solid 1px ${colorSchemeVar}`,
        ),
        borderTop: mapObjectValues(
            colorSchemeVarsWithTransparent,
            colorSchemeVar => `solid 1px ${colorSchemeVar}`,
        ),
        borderBottom: mapObjectValues(
            colorSchemeVarsWithTransparent,
            colorSchemeVar => `solid 1px ${colorSchemeVar}`,
        ),
        borderLeft: mapObjectValues(
            colorSchemeVarsWithTransparent,
            colorSchemeVar => `solid 1px ${colorSchemeVar}`,
        ),
        borderRight: mapObjectValues(
            colorSchemeVarsWithTransparent,
            colorSchemeVar => `solid 1px ${colorSchemeVar}`,
        ),
        borderWidth: {base: 1, thick: 2},
    },
});

export type Sprinkles = Parameters<typeof sprinkles>[0];

export const sprinkles = createSprinkles(properties, responsiveProperties, colorProperties);
