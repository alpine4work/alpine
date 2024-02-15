import {keyframes, style} from "@vanilla-extract/css";

// These constants are exported from `navigation_bar.tsx` for convenience.
// Generally you'll import from there unless you need this constant in CSS.
//
// The desktop navigation bar height is carefully selected so that a spacing
// `6` button can have spacing `5` margin left and spacing `5` margin top
// within the navigation bar. This ends up looking nice when the navigation bar
// is flat with the rest of the content.
export const desktopNavigationBarHeight = "16";
export const mobileNavigationBarHeight = "14";

const navigationBarBackgroundFadeOutKeyframes = keyframes({
    from: {opacity: 1},
    to: {opacity: 0},
});

export const navigationBarBackgroundFadeOutAnimationClassName = style({
    animation: `${navigationBarBackgroundFadeOutKeyframes} 200ms ease-out forwards`,
});

const navigationBarTitleFadeOutKeyframes = keyframes({
    from: {opacity: 1, transform: "translateY(0rem)"},
    to: {opacity: 0, transform: "translateY(-0.375rem)"},
});

export const navigationBarTitleFadeOutAnimationClassName = style({
    transformOrigin: "top center",
    animation: `${navigationBarTitleFadeOutKeyframes} 500ms cubic-bezier(0.25, 1, 0.5, 1) forwards`,
});
