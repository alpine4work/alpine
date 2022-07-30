/*!
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
import {
    colorSchemeVars,
    darkColorSchemeSelector,
    lightColorSchemeSelector,
} from "~/client/ui/color-scheme.css";
import {spacing} from "~/shared/styles/spacing";

// TODO(calebmer): Add these styles:
// - Typography styles
// - Border styles
// - Border radius styles
// - Elevation styles
// - Focus ring styles

const properties = defineProperties({
    properties: {
        overflow: ["auto", "hidden", "visible", "scroll"],
        overflowX: ["auto", "hidden", "visible", "scroll"],
        overflowY: ["auto", "hidden", "visible", "scroll"],
        position: ["static", "relative", "absolute"],
        zIndex: [0, 10, 20, 30, 40, 50, -10, -20, -30, -40, -50],
        cursor: [
            "auto",
            "default",
            "pointer",
            "text",
            "move",
            "grab",
            "grabbing",
            "col-resize",
            "row-resize",
        ],
        pointerEvents: ["auto", "none"],
        userSelect: ["auto", "none", "text", "all"],
        borderRadius: {
            "rounded-none": "0rem",
            "rounded-full": "9999px",
        },
    },
});

const spacingWithPercentages = {
    ...spacing,
    "spacing-full": "100%",
    "spacing-1/2": "50%",
    "spacing-1/3": "33.333333%",
    "spacing-2/3": "66.666667%",
    "spacing-1/4": "25%",
    "spacing-2/4": "50%",
    "spacing-3/4": "75%",
    "spacing-1/5": "20%",
    "spacing-2/5": "40%",
    "spacing-3/5": "60%",
    "spacing-4/5": "80%",
    "spacing-1/6": "16.666667%",
    "spacing-2/6": "33.333333%",
    "spacing-3/6": "50%",
    "spacing-4/6": "66.666667%",
    "spacing-5/6": "83.333333%",
    "spacing-1/12": "8.333333%",
    "spacing-2/12": "16.666667%",
    "spacing-3/12": "25%",
    "spacing-4/12": "33.333333%",
    "spacing-5/12": "41.666667%",
    "spacing-6/12": "50%",
    "spacing-7/12": "58.333333%",
    "spacing-8/12": "66.666667%",
    "spacing-9/12": "75%",
    "spacing-10/12": "83.333333%",
    "spacing-11/12": "91.666667%",
};

export const mobileMediaQuery = "screen and (max-width: 768px)";

const responsiveProperties = defineProperties({
    conditions: {
        mobile: {"@media": mobileMediaQuery},
        desktop: {},
    },
    defaultCondition: "desktop",
    properties: {
        display: ["none", "block", "inline-block", "inline", "flex", "inline-flex"],
        top: spacing,
        bottom: spacing,
        left: spacing,
        right: spacing,
        flexDirection: ["row", "row-reverse", "column", "column-reverse"],
        flexWrap: ["wrap", "wrap-reverse", "nowrap"],
        flex: {
            1: "1 1 0%",
            auto: "1 1 auto",
            initial: "0 1 auto",
            none: "none",
        },
        flexGrow: [1, 0],
        flexShrink: [1, 0],
        justifyContent: [
            "flex-start",
            "flex-end",
            "center",
            "space-between",
            "space-around",
            "space-evenly",
        ],
        alignItems: ["flex-start", "flex-end", "center", "stretch", "baseline"],
        alignSelf: ["auto", "flex-start", "flex-end", "center", "stretch", "baseline"],
        paddingTop: spacing,
        paddingBottom: spacing,
        paddingLeft: spacing,
        paddingRight: spacing,
        marginTop: spacing,
        marginBottom: spacing,
        marginLeft: spacing,
        marginRight: spacing,
        width: spacingWithPercentages,
        minWidth: spacingWithPercentages,
        maxWidth: spacingWithPercentages,
        height: spacingWithPercentages,
        minHeight: spacingWithPercentages,
        maxHeight: spacingWithPercentages,
    },
    shorthands: {
        padding: ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"],
        paddingX: ["paddingLeft", "paddingRight"],
        paddingY: ["paddingTop", "paddingBottom"],
        margin: ["marginTop", "marginBottom", "marginLeft", "marginRight"],
        marginX: ["marginLeft", "marginRight"],
        marginY: ["marginTop", "marginBottom"],
    },
});

const colorProperties = defineProperties({
    conditions: {
        default: {},
        light: {selector: `${lightColorSchemeSelector} &`},
        dark: {selector: `${darkColorSchemeSelector} &`},
        hover: {selector: "&:hover"},
        hoverLight: {selector: `${lightColorSchemeSelector} &:hover`},
        hoverDark: {selector: `${darkColorSchemeSelector} &:hover`},
    },
    defaultCondition: "default",
    properties: {
        color: colorSchemeVars,
        backgroundColor: {...colorSchemeVars, transparent: "transparent"},
    },
});

export type Sprinkles = Parameters<typeof sprinkles>[0];

export const sprinkles = createSprinkles(properties, responsiveProperties, colorProperties);
