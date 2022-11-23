import {keyframes, style} from "@vanilla-extract/css";

const spinAnimationKeyframes = keyframes({
    from: {transform: "rotate(90deg)"},
    to: {transform: "rotate(450deg)"},
});

export const spinAnimationClassName = style({
    animation: `${spinAnimationKeyframes} 1000ms linear infinite`,
});
