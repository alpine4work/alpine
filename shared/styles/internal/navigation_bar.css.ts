import {keyframes, style} from "@vanilla-extract/css";

const navigationBarFadeOutKeyframes = keyframes({
    from: {opacity: 1},
    to: {opacity: 0},
});

export const navigationBarFadeOutAnimationClassName = style({
    animation: `${navigationBarFadeOutKeyframes} 100ms ease forwards`,
});
