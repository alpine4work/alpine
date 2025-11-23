import {createVar, globalStyle, keyframes, style} from "@vanilla-extract/css";
import {darkColorSchemeSelector} from "~/client/web/styles/core/styles_core.js";
import {extrapolateHighlightColor} from "~/client/web/styles/other/internal/helpers/extrapolate_highlight_color.js";
import {
    overlayFadeInOutTimingFunction,
    overlayFadeOutAnimationDurationMs,
} from "~/client/web/styles/other/internal/overlay_animated.css.js";
import {colors} from "~/shared/design/core/colors.js";
import {invertedColorsWithShade} from "~/shared/design/core/inverted_colors.js";

// We completely hide all native scrollbars since we render custom scrollbars
// in JavaScript.
//
// We choose to render custom scrollbars for design consistency across
// platforms. Not all platforms have a scrollbar design that:
//
// 1. Overlays content
// 2. Is hidden by default
//
// MacOS default scrollbars have these properties but you can change an OS
// configuration option to always show scrollbars. Windows does not have
// scrollbars like this.

export const nativeScrollbarClassName = style({});

globalStyle(`:not(${nativeScrollbarClassName})`, {
    // TypeScript doesn't like `!important` but it works
    // https://github.com/frenic/csstype/issues/114
    // @ts-expect-error
    scrollbarWidth: "none !important",
});

globalStyle(
    `:not(${nativeScrollbarClassName})::-webkit-scrollbar, :not(${nativeScrollbarClassName})::-webkit-scrollbar-corner`,
    {
        // TypeScript doesn't like `!important` but it works
        // https://github.com/frenic/csstype/issues/114
        // @ts-expect-error
        appearance: "none !important",
        display: "none !important",
        width: "0 !important",
        height: "0 !important",
    },
);

const scrollbarColorVar = createVar("scrollbar");
const scrollbarHoverColorVar = createVar("scrollbar-hover");
const scrollbarActiveColorVar = createVar("scrollbar-active");

const scrollbarOpacity = 3 / 5;

globalStyle(":root", {
    vars: {
        [scrollbarColorVar]: extrapolateHighlightColor(
            colors["grey-0"],
            colors["grey-20"],
            scrollbarOpacity,
        ),
        [scrollbarHoverColorVar]: extrapolateHighlightColor(
            colors["grey-0"],
            colors["grey-30"],
            scrollbarOpacity,
        ),
        [scrollbarActiveColorVar]: extrapolateHighlightColor(
            colors["grey-0"],
            colors["grey-40"],
            scrollbarOpacity,
        ),
    },
});

globalStyle(darkColorSchemeSelector, {
    vars: {
        [scrollbarColorVar]: extrapolateHighlightColor(
            invertedColorsWithShade["grey-0"],
            invertedColorsWithShade["grey-20"],
            scrollbarOpacity,
        ),
        [scrollbarHoverColorVar]: extrapolateHighlightColor(
            invertedColorsWithShade["grey-0"],
            invertedColorsWithShade["grey-30"],
            scrollbarOpacity,
        ),
        [scrollbarActiveColorVar]: extrapolateHighlightColor(
            invertedColorsWithShade["grey-0"],
            invertedColorsWithShade["grey-40"],
            scrollbarOpacity,
        ),
    },
});

export const scrollbarThumbHitClassName = style({
    width: "100%",
    height: "100%",
    pointerEvents: "auto",
});

export const scrollbarThumbHoveredClassName = style({});

export const scrollbarThumbDraggingClassName = style({
    backgroundColor: scrollbarActiveColorVar,
});

export const scrollbarThumbClassName = style({
    width: "100%",
    height: "100%",
    selectors: {
        [`&:not(${scrollbarThumbDraggingClassName})`]: {
            backgroundColor: scrollbarColorVar,
        },
        [`&${scrollbarThumbHoveredClassName}:not(${scrollbarThumbDraggingClassName})`]: {
            backgroundColor: scrollbarHoverColorVar,
        },
    },
});

export const scrollbarThumbHitHideClassName = style({
    display: "none",
});

const scrollbarThumbFadeOutKeyframes = keyframes({
    from: {opacity: 1},
    to: {opacity: 0},
});

export const scrollbarThumbFadeOutAnimationDurationMs = overlayFadeOutAnimationDurationMs;

const scrollbarThumbFadeOutAnimation = `${scrollbarThumbFadeOutKeyframes} ${scrollbarThumbFadeOutAnimationDurationMs}ms ${overlayFadeInOutTimingFunction} forwards`;

export const scrollbarThumbHitFadeOutClassName = style({
    animation: scrollbarThumbFadeOutAnimation,
});
