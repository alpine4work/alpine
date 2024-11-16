import {keyframes, style} from "@vanilla-extract/css";
import {easeInQuart, easeOutQuart} from "~/shared/design/core/easing.js";
import {Spacing, parseRemLength} from "~/shared/design/core/spacing.js";

// These constants are exported from `navigation_bar.tsx` for convenience.
// Generally you'll import from there unless you need this constant in CSS.
export const navigationBarHeight: Spacing = "14";
export const navigationBarHeightRem = parseRemLength(navigationBarHeight);

const navigationBarTitleFadeOutKeyframes = keyframes({
    from: {opacity: 1, transform: "translateY(0rem)"},
    to: {opacity: 0, transform: "translateY(-0.25rem)"},
});

export const navigationBarTitleFadeOutAnimationClassName = style({
    transformOrigin: "top center",
    animation: `${navigationBarTitleFadeOutKeyframes} 250ms ${easeOutQuart.cubicBezier} forwards`,
});

const navigationBarTitleFadeInKeyframes = keyframes({
    from: {opacity: 0, transform: "translateY(-0.25rem)"},
    to: {opacity: 1, transform: "translateY(0rem)"},
});

export const navigationBarTitleFadeInAnimationClassName = style({
    transformOrigin: "top center",
    animation: `${navigationBarTitleFadeInKeyframes} 250ms ${easeInQuart.cubicBezier} forwards`,
});
