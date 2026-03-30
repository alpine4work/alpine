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

import {createVar, fallbackVar, globalStyle} from "@vanilla-extract/css";
import {createSprinkles, defineProperties} from "@vanilla-extract/sprinkles";
import murmurhash from "murmurhash";
import {
    CssVarFunction,
    colorSchemeVars,
    darkColorSchemeSelector,
    lightColorSchemeSelector,
} from "~/client/web/styles/core/internal/color_scheme.css.js";
import {elevationVars} from "~/client/web/styles/core/internal/elevation.css.js";
import {fontSizes, fontStyles} from "~/client/web/styles/core/internal/fonts.css.js";
import {
    desktopPlatformSelector,
    mobilePlatformSelector,
} from "~/client/web/styles/core/internal/selectors.css.js";
import {borderRadius} from "~/shared/design/core/border_radius.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";

const overscrollBehaviorVar = createVar("overscroll-behavior");

const overscrollBehaviorVarWithFallback = fallbackVar(overscrollBehaviorVar, "none");
export {overscrollBehaviorVarWithFallback as overscrollBehaviorVar};

globalStyle(mobilePlatformSelector, {
    vars: {
        [overscrollBehaviorVar]: "contain",
    },
});

const properties = defineProperties({
    properties: {
        // Wherever we have `overflow: "auto"` or `overflow: "scroll"` also add
        // `overscrollBehavior: "none"` (`"contain"` on mobile) to prevent scroll
        // chaining. This is generally a better user experience for elements like drop
        // down menus and modals which is why we make it the default.
        //
        // It's especially important, however, on iOS Safari when the keyboard is open.
        // iOS Safari is annoying and makes the `html` element unconditionally
        // scrollable when the keyboard is open. So if the user scrolls a scrollable
        // element we can't let overscroll affect the newly scrollable `html` element.
        //
        // We use `overscrollBehavior: "none"` on desktop because the default MacOS
        // scroll bouncing doesn't feel right for our rich application. And sometimes
        // looks outright strange when you have sticky top bars/bottom bars that don't
        // move with the bounce. On mobile, however, scrolling feels broken if it
        // doesn't bounce.
        overflow: {
            auto: {overflow: "auto", overscrollBehavior: overscrollBehaviorVarWithFallback},
            hidden: "hidden",
            visible: "visible",
            scroll: {overflow: "scroll", overscrollBehavior: overscrollBehaviorVarWithFallback},
        },
        overflowX: {
            auto: {overflowX: "auto", overscrollBehaviorX: overscrollBehaviorVarWithFallback},
            hidden: "hidden",
            visible: "visible",
            scroll: {overflowX: "scroll", overscrollBehaviorX: overscrollBehaviorVarWithFallback},
        },
        overflowY: {
            auto: {overflowY: "auto", overscrollBehaviorY: overscrollBehaviorVarWithFallback},
            hidden: "hidden",
            visible: "visible",
            scroll: {overflowY: "scroll", overscrollBehaviorY: overscrollBehaviorVarWithFallback},
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
            "not-allowed": "not-allowed",
        },
        pointerEvents: {auto: "auto", none: "none"},
        userSelect: {
            none: "none",
            // When `user-select` is `"text"` we need to override our global default
            // `cursor: "default"`.
            text: {userSelect: "text", cursor: "auto"},
        },
        touchAction: {
            none: "none",
            auto: "auto",
        },
        textAlign: {left: "left", center: "center", right: "right", justify: "justify"},
        fontStyle: mapObjectValues(fontStyles, style => {
            if (!("letterSpacing" in style)) return style;

            return {
                ...omitObject(style, ["letterSpacing"]),
                selectors: {
                    // Use a triple selector so that this letter spacing overrides the letter
                    // spacing of a `fontSizes` size with a condition. Letter spacing in
                    // `fontSizes` with size has a specificity of 2. One for the
                    // selector and one for the media query. So quadruple selector beats it.
                    "&&&": {letterSpacing: style.letterSpacing},
                },
            };
        }),
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
        mobile: {selector: `${mobilePlatformSelector} &`},
        desktop: {selector: `${desktopPlatformSelector} &`},
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
        paddingTop: {...spacing, "safe-area-inset": "var(--safe-area-inset-top, 0px)"},
        paddingBottom: {
            ...spacing,
            "safe-area-inset": "var(--safe-area-inset-bottom, 0px)",
            "window-safe-area-inset": "var(--window-safe-area-inset-bottom, 0px)",
        },
        paddingLeft: {...spacing, "safe-area-inset": "var(--safe-area-inset-left, 0px)"},
        paddingRight: {...spacing, "safe-area-inset": "var(--safe-area-inset-right, 0px)"},
        marginTop: {...spacingWithNegatives, auto: "auto"},
        marginBottom: {...spacingWithNegatives, auto: "auto"},
        // `marginLeft` and `marginRight` have `center` which lets us do
        // `marginX="center"`.
        marginLeft: {...spacingWithNegatives, auto: "auto", center: {marginLeft: "auto"}},
        marginRight: {...spacingWithNegatives, auto: "auto", center: {marginRight: "auto"}},
        width: {
            ...spacingWithPercentages,
            auto: "auto",
            "fit-content": "fit-content",
            border: 1,
            "border-thick": 2,
            // Includes top and bottom for easy use with a `<Spacer>` component.
            "safe-area-inset-top": "var(--safe-area-inset-top, 0px)",
            "safe-area-inset-bottom": "var(--safe-area-inset-bottom, 0px)",
            "safe-area-inset-left": "var(--safe-area-inset-left, 0px)",
            "safe-area-inset-right": "var(--safe-area-inset-right, 0px)",
        },
        minWidth: {...spacingWithPercentages, none: "none"},
        maxWidth: {...spacingWithPercentages, none: "none"},
        height: {
            ...spacingWithPercentages,
            auto: "auto",
            border: 1,
            "border-thick": 2,
            // Includes left and right for easy use with a `<Spacer>` component.
            "safe-area-inset-top": "var(--safe-area-inset-top, 0px)",
            "safe-area-inset-bottom": "var(--safe-area-inset-bottom, 0px)",
            "safe-area-inset-left": "var(--safe-area-inset-left, 0px)",
            "safe-area-inset-right": "var(--safe-area-inset-right, 0px)",
        },
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
        borderTopWidth: {
            // Use a quadruple selector so that this border width overrides the border
            // width of a `colorProperties` border with a condition. Border width in
            // `colorProperties` with condition has a specificity of 3. One for the
            // selector and two for the condition (in light mode we have `:root:not(...)`
            // as the condition). So quadruple selector beats it.
            none: {selectors: {"&&&&": {borderTopWidth: 0}}},
            base: {selectors: {"&&&&": {borderTopWidth: 1}}},
            thick: {selectors: {"&&&&": {borderTopWidth: 2}}},
        },
        borderBottomWidth: {
            // Use a quadruple selector so that this border width overrides the border
            // width of a `colorProperties` border with a condition. Border width in
            // `colorProperties` with condition has a specificity of 3. One for the
            // selector and two for the condition (in light mode we have `:root:not(...)`
            // as the condition). So quadruple selector beats it.
            none: {selectors: {"&&&&": {borderBottomWidth: 0}}},
            base: {selectors: {"&&&&": {borderBottomWidth: 1}}},
            thick: {selectors: {"&&&&": {borderBottomWidth: 2}}},
        },
        borderLeftWidth: {
            // Use a quadruple selector so that this border width overrides the border
            // width of a `colorProperties` border with a condition. Border width in
            // `colorProperties` with condition has a specificity of 3. One for the
            // selector and two for the condition (in light mode we have `:root:not(...)`
            // as the condition). So quadruple selector beats it.
            none: {selectors: {"&&&&": {borderLeftWidth: 0}}},
            base: {selectors: {"&&&&": {borderLeftWidth: 1}}},
            thick: {selectors: {"&&&&": {borderLeftWidth: 2}}},
        },
        borderRightWidth: {
            // Use a quadruple selector so that this border width overrides the border
            // width of a `colorProperties` border with a condition. Border width in
            // `colorProperties` with condition has a specificity of 3. One for the
            // selector and two for the condition (in light mode we have `:root:not(...)`
            // as the condition). So quadruple selector beats it.
            base: {selectors: {"&&&&": {borderRightWidth: 1}}},
            none: {selectors: {"&&&&": {borderRightWidth: 0}}},
            thick: {selectors: {"&&&&": {borderRightWidth: 2}}},
        },
        boxShadow: elevationVars,
        fontSize: fontSizes,
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
            "30": 0.3,
            "40": 0.4,
            "50": 0.5,
            "60": 0.6,
            "70": 0.7,
            "80": 0.8,
            "90": 0.9,
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

// Export a hash of our `sprinkles()` definition. This will cause us to fully
// reload the page when the sprinkles function changes. Otherwise we ignore
// changes to the sprinkles function in our `import.meta.hot.accept()` call in
// `client/styles/styles.ts` since we can't determine function equality between
// modules.
export const sprinklesHash = murmurhash
    .v3(JSON.stringify([properties, responsiveProperties, colorProperties]))
    .toString(16)
    .padStart(8, "0");
