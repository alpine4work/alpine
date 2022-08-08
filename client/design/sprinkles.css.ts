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
} from "~/client/design/color-scheme.css";
import {fontScale} from "~/shared/design/fonts";
import {spacing} from "~/shared/design/spacing";
import {mapObjectValues} from "~/shared/helpers/object/map-object-values";

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
            none: "0rem",
            base: "0.25rem",
            full: "9999px",
        },
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
        gap: spacing,
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

        // We intend for font properties to be used with the `font` shorthand. So you
        // can say `font="sm"` and get the appropriate size, line height, and letter
        // spacing at once.
        fontSize: mapObjectValues(fontScale, ({fontSize}) => fontSize),
        lineHeight: mapObjectValues(fontScale, ({lineHeight}) => lineHeight),
        letterSpacing: mapObjectValues(fontScale, ({letterSpacing}) => letterSpacing),
    },
    shorthands: {
        padding: ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"],
        paddingX: ["paddingLeft", "paddingRight"],
        paddingY: ["paddingTop", "paddingBottom"],
        margin: ["marginTop", "marginBottom", "marginLeft", "marginRight"],
        marginX: ["marginLeft", "marginRight"],
        marginY: ["marginTop", "marginBottom"],
        font: ["fontSize", "lineHeight", "letterSpacing"],
    },
});

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
        backgroundColor: {...colorSchemeVars, transparent: "transparent"},

        // Default to thin 1px borders over chunky borders.
        border: mapObjectValues(colorSchemeVars, colorSchemeVar => `solid 1px ${colorSchemeVar}`),
        borderTop: mapObjectValues(
            colorSchemeVars,
            colorSchemeVar => `solid 1px ${colorSchemeVar}`,
        ),
        borderBottom: mapObjectValues(
            colorSchemeVars,
            colorSchemeVar => `solid 1px ${colorSchemeVar}`,
        ),
        borderLeft: mapObjectValues(
            colorSchemeVars,
            colorSchemeVar => `solid 1px ${colorSchemeVar}`,
        ),
        borderRight: mapObjectValues(
            colorSchemeVars,
            colorSchemeVar => `solid 1px ${colorSchemeVar}`,
        ),
    },
});

export type Sprinkles = Parameters<typeof sprinkles>[0];

export const sprinkles = createSprinkles(properties, responsiveProperties, colorProperties);
