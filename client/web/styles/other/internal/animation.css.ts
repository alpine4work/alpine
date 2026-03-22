import {keyframes, style} from "@vanilla-extract/css";

const spinAnimationKeyframes = keyframes({
    from: {transform: "rotate(90deg)"},
    to: {transform: "rotate(450deg)"},
});

export const spinAnimationClassName = style({
    animation: `${spinAnimationKeyframes} 1000ms linear infinite`,
});

const pulseAnimationKeyframes = keyframes({
    "50%": {opacity: "50%"},
});

// The pulse animation is taken directly from Tailwind CSS.
// https://github.com/tailwindlabs/tailwindcss/blob/8e60a3c7e81ea0e44f127aa30df6d5676c60133d/stubs/defaultConfig.stub.js#L15
export const pulseAnimation = `${pulseAnimationKeyframes} 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`;

export const pulseAnimationClassName = style({
    animation: pulseAnimation,
});

const pulseAnimationWithReducedOpacityKeyframes = keyframes({
    "50%": {opacity: "40%"}, // 0.5 \* 0.8
    "100%": {opacity: "80%"},
});

export const pulseAnimationWithReducedOpacity = `${pulseAnimationWithReducedOpacityKeyframes} 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`;

export const pulseAnimationWithReducedOpacityClassName = style({
    opacity: "80%",
    animation: pulseAnimationWithReducedOpacity,
});

const pingAnimationKeyframes = keyframes({
    "0%": {
        opacity: 0.75,
    },
    "25%, 100%": {
        transform: "scale(1.75)",
        opacity: 0,
    },
});

// The ping animation is taken from Tailwind CSS.
// https://github.com/tailwindlabs/tailwindcss/blob/8e60a3c7e81ea0e44f127aa30df6d5676c60133d/stubs/defaultConfig.stub.js#L14
export const pingAnimationClassName = style({
    animation: `${pingAnimationKeyframes} 2s cubic-bezier(0, 0, 0.2, 1) infinite`,
});

// The ping animation is taken from Tailwind CSS but with a longer delay between
// pulses.
// https://github.com/tailwindlabs/tailwindcss/blob/8e60a3c7e81ea0e44f127aa30df6d5676c60133d/stubs/defaultConfig.stub.js#L14
export const pingAnimationWithDelayClassName = style({
    animation: `${pingAnimationKeyframes} 3s cubic-bezier(0, 0, 0.2, 1) 1s infinite`,
});
