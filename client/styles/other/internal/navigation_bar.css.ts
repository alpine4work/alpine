import {keyframes, style} from "@vanilla-extract/css";
import {easeInQuart, easeOutQuart} from "~/shared/design/core/easing.js";
import {Spacing, parseRemLength} from "~/shared/design/core/spacing.js";

// These constants are exported from `navigation_bar.tsx` for convenience.
// Generally you'll import from there unless you need this constant in CSS.
export const navigationBarHeight: Spacing = "14";
export const navigationBarHeightRem = parseRemLength(navigationBarHeight);

const titleFadeOutKeyframes = keyframes({
    from: {opacity: 1, transform: "translateY(0rem)"},
    to: {opacity: 0, transform: "translateY(-0.25rem)"},
});

export const titleFadeOutAnimationClassName = style({
    transformOrigin: "top center",
    animation: `${titleFadeOutKeyframes} 250ms ${easeOutQuart.cubicBezier} forwards`,
});

const titleFadeInKeyframes = keyframes({
    from: {opacity: 0, transform: "translateY(-0.25rem)"},
    to: {opacity: 1, transform: "translateY(0rem)"},
});

export const titleFadeInAnimationClassName = style({
    transformOrigin: "top center",
    animation: `${titleFadeInKeyframes} 250ms ${easeInQuart.cubicBezier} forwards`,
});
