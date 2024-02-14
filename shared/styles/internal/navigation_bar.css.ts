import {keyframes, style} from "@vanilla-extract/css";

/**
 * The height of our navigation bar.
 */
// This constant is exported from `use_navigation_bar.tsx` for convenience.
// Generally you'll import from there unless you need this constant in CSS.
export const navigationBarHeight = "16";

const navigationBarBackgroundFadeOutKeyframes = keyframes({
    from: {opacity: 1},
    to: {opacity: 0},
});

export const navigationBarBackgroundFadeOutAnimationClassName = style({
    animation: `${navigationBarBackgroundFadeOutKeyframes} 100ms ease-out forwards`,
});

const navigationBarTitleFadeOutKeyframes = keyframes({
    from: {opacity: 1, transform: "translateY(0rem)"},
    to: {opacity: 0, transform: "translateY(-0.5rem)"},
});

export const navigationBarTitleFadeOutAnimationClassName = style({
    animation: `${navigationBarTitleFadeOutKeyframes} 200ms ease-in forwards`,
});
