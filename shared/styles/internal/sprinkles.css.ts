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

// Make sure our sprinkles styles come after our content schema styles in the
// final CSS style sheet. That way sprinkles classes can override content
// schema styles.
//
// We added this ordering for `<TaskDetailNotesField>` which sets a `minHeight`
// on a `<ContentEditor>` whereas `content_schema.css.ts` sets `minHeight`
// to 100%.
import "~/shared/styles/internal/content_schema.css.js";

import {createVar} from "@vanilla-extract/css";
import {createSprinkles, defineProperties} from "@vanilla-extract/sprinkles";
import {
    desktopPlatformMediaQuery,
    mobilePlatformMediaQuery,
    spacing,
} from "~/shared/design/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {borderRadius} from "~/shared/styles/internal/border_radius.css.js";
import {
    CssVarFunction,
    colorSchemeVars,
    darkColorSchemeSelector,
    lightColorSchemeSelector,
} from "~/shared/styles/internal/color_scheme.css.js";
import {elevationVars} from "~/shared/styles/internal/elevation.css.js";
import {fontSizes, fontStyles} from "~/shared/styles/internal/fonts.css.js";

const properties = defineProperties({
    properties: {
        // Wherever we have `overflow: "auto"` or `overflow: "scroll"` also add
        // `overscrollBehavior: "contain"` to prevent scroll chaining. This is
        // generally a better user experience for elements like drop down menus and
        // modals which is why we make it the default.
        //
        // It's especially important, however, on iOS Safari when the keyboard is open.
        // iOS Safari is annoying and makes the `html` element unconditionally
        // scrollable when the keyboard is open. So if the user scrolls a scrollable
        // element we can't let overscroll affect the newly scrollable `html` element.
        overflow: {
            auto: {overflow: "auto", overscrollBehavior: "contain"},
            hidden: "hidden",
            visible: "visible",
            scroll: {overflow: "scroll", overscrollBehavior: "contain"},
        },
        overflowX: {
            auto: {overflowX: "auto", overscrollBehavior: "contain"},
            hidden: "hidden",
            visible: "visible",
            scroll: {overflowX: "scroll", overscrollBehavior: "contain"},
        },
        overflowY: {
            auto: {overflowY: "auto", overscrollBehavior: "contain"},
            hidden: "hidden",
            visible: "visible",
            scroll: {overflowY: "scroll", overscrollBehavior: "contain"},
        },
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
            "60": 60,
            "70": 70,
            "80": 80,
            "90": 90,
            "-10": -10,
            "-20": -20,
            "-30": -30,
            "-40": -40,
            "-50": -50,
            "-60": -60,
            "-70": -70,
            "-80": -80,
            "-90": -90,
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
        userSelect: {
            none: "none",
            // When `user-select` is `"text"` we need to override our global default
            // `cursor: "default"`.
            text: {userSelect: "text", cursor: "auto"},
        },
        textAlign: {left: "left", center: "center", right: "right", justify: "justify"},
        fontSize: fontSizes,
        fontStyle: fontStyles,
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
        [K in keyof typeof spacing as `-${K}`]: `-${(typeof spacing)[K]}`;
    }),
};

const responsiveProperties = defineProperties({
    conditions: {
        default: {},
        mobile: {"@media": mobilePlatformMediaQuery},
        desktop: {"@media": desktopPlatformMediaQuery},
    },
    defaultCondition: "default",
    properties: {
        display: {
            none: "none",
            block: "block",
            "inline-block": "inline-block",
            inline: "inline",
            flex: "flex",
            "inline-flex": "inline-flex",
            grid: "grid",
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
        rowGap: spacing,
        columnGap: spacing,
        paddingTop: spacing,
        paddingBottom: spacing,
        paddingLeft: spacing,
        paddingRight: spacing,
        marginTop: {...spacingWithNegatives, auto: "auto"},
        marginBottom: {...spacingWithNegatives, auto: "auto"},
        marginLeft: {...spacingWithNegatives, auto: "auto"},
        marginRight: {...spacingWithNegatives, auto: "auto"},
        width: {...spacingWithPercentages, auto: "auto"},
        minWidth: {...spacingWithPercentages, none: "none"},
        maxWidth: {...spacingWithPercentages, none: "none"},
        height: {...spacingWithPercentages, auto: "auto"},
        minHeight: {...spacingWithPercentages, none: "none"},
        maxHeight: {...spacingWithPercentages, none: "none"},
        borderTopLeftRadius: borderRadius,
        borderTopRightRadius: borderRadius,
        borderBottomLeftRadius: borderRadius,
        borderBottomRightRadius: borderRadius,
        borderWidth: {
            // Use a quadruple selector so that this border width overrides the border
            // width of a `colorProperties` border with a condition. Border width in
            // `colorProperties` with condition has a specificity of 3. One for the
            // selector and two for the condition (in light mode we have `:root:not(...)`
            // as the condition). So quadruple selector beats it.
            none: {selectors: {"&&&&": {borderWidth: 0}}},
            base: {selectors: {"&&&&": {borderWidth: 1}}},
            thick: {selectors: {"&&&&": {borderWidth: 2}}},
        },
        boxShadow: elevationVars,
    },
    shorthands: {
        inset: ["top", "bottom", "left", "right"],
        padding: ["paddingTop", "paddingBottom", "paddingLeft", "paddingRight"],
        paddingX: ["paddingLeft", "paddingRight"],
        paddingY: ["paddingTop", "paddingBottom"],
        margin: ["marginTop", "marginBottom", "marginLeft", "marginRight"],
        marginX: ["marginLeft", "marginRight"],
        marginY: ["marginTop", "marginBottom"],
        borderRadius: [
            "borderTopLeftRadius",
            "borderTopRightRadius",
            "borderBottomLeftRadius",
            "borderBottomRightRadius",
        ],
        borderTopRadius: ["borderTopLeftRadius", "borderTopRightRadius"],
        borderBottomRadius: ["borderBottomLeftRadius", "borderBottomRightRadius"],
        borderLeftRadius: ["borderTopLeftRadius", "borderBottomLeftRadius"],
        borderRightRadius: ["borderTopRightRadius", "borderBottomRightRadius"],
    },
});

const colorSchemeVarsWithTransparent = {...colorSchemeVars, transparent: "transparent"};

export const backgroundColorVar: CssVarFunction = createVar("background-color");

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
        backgroundColor: mapObjectValues(colorSchemeVarsWithTransparent, colorSchemeVar => ({
            backgroundColor: colorSchemeVar,
            vars: {[backgroundColorVar]: colorSchemeVar},
        })),
        fill: colorSchemeVars,

        // Default to thin 1px borders over chunky borders.
        border: {
            ...mapObjectValues(colorSchemeVarsWithTransparent, colorSchemeVar => ({
                borderStyle: "solid",
                borderWidth: 1,
                borderColor: colorSchemeVar,
            })),
            none: {
                border: "none",
            },
        },
        borderTop: {
            ...mapObjectValues(colorSchemeVarsWithTransparent, colorSchemeVar => ({
                borderStyle: "solid",
                borderTopWidth: 1,
                borderTopColor: colorSchemeVar,
            })),
            none: {
                borderTop: "none",
            },
        },
        borderBottom: {
            ...mapObjectValues(colorSchemeVarsWithTransparent, colorSchemeVar => ({
                borderStyle: "solid",
                borderBottomWidth: 1,
                borderBottomColor: colorSchemeVar,
            })),
            none: {
                borderBottom: "none",
            },
        },
        borderLeft: {
            ...mapObjectValues(colorSchemeVarsWithTransparent, colorSchemeVar => ({
                borderStyle: "solid",
                borderLeftWidth: 1,
                borderLeftColor: colorSchemeVar,
            })),
            none: {
                borderLeft: "none",
            },
        },
        borderRight: {
            ...mapObjectValues(colorSchemeVarsWithTransparent, colorSchemeVar => ({
                borderStyle: "solid",
                borderRightWidth: 1,
                borderRightColor: colorSchemeVar,
            })),
            none: {
                borderRight: "none",
            },
        },
        opacity: {
            "0": 0,
            "10": 0.1,
            "20": 0.2,
            "40": 0.4,
            "60": 0.6,
            "80": 0.8,
            "100": 1,
        },
    },
    shorthands: {
        borderX: ["borderLeft", "borderRight"],
        borderY: ["borderTop", "borderBottom"],
    },
});

export type Sprinkles = Parameters<typeof sprinkles>[0];

export const sprinkles = createSprinkles(properties, responsiveProperties, colorProperties);
