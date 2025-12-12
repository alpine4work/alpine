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
    "50%": {opacity: "40%"}, // 0.5 * 0.8
    "100%": {opacity: "80%"},
});

export const pulseAnimationWithReducedOpacity = `${pulseAnimationWithReducedOpacityKeyframes} 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`;

export const pulseAnimationWithReducedOpacityClassName = style({
    opacity: "80%",
    animation: pulseAnimationWithReducedOpacity,
});

const pulseAnimationWithMoreOpacityKeyframes = keyframes({
    "50%": {opacity: "70%"},
});

// The pulse animation is taken directly from Tailwind CSS.
// https://github.com/tailwindlabs/tailwindcss/blob/8e60a3c7e81ea0e44f127aa30df6d5676c60133d/stubs/defaultConfig.stub.js#L15
export const pulseWithMoreOpacityAnimation = `${pulseAnimationWithMoreOpacityKeyframes} 2s cubic-bezier(0.4, 0, 0.6, 1) infinite`;

export const pulseAnimationWithMoreOpacityClassName = style({
    animation: pulseWithMoreOpacityAnimation,
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

// The ping animation is taken from Tailwind CSS but with a longer delay
// between pulses.
// https://github.com/tailwindlabs/tailwindcss/blob/8e60a3c7e81ea0e44f127aa30df6d5676c60133d/stubs/defaultConfig.stub.js#L14
export const pingAnimationClassName = style({
    animation: `${pingAnimationKeyframes} 3s cubic-bezier(0, 0, 0.2, 1) 1s infinite`,
});

// The animation for making a general wave opacity effect.
// Useful for loading texts (like AI thinking indicators).
const waveAnimationKeyframes = keyframes({
    "0%": {
        maskPosition: "100% 0",
    },
    "100%": {
        maskPosition: "-100% 0",
    },
});

const waveOpacity = 0.5;

export const waveAnimationClassName = style({
    mask: `linear-gradient(135deg, rgba(255, 255, 255, ${waveOpacity}) 0%, white 10%, white 90%, rgba(255, 255, 255, ${waveOpacity}) 100%)`,
    maskSize: "200% 100%",
    maskPosition: "100% 0",
    // 1.8s is intentional, we want this animation to be slightly offset from the
    // timing of the pulse animation. In case you have an element that's using both
    // the animations shouldn't line up.
    animation: `${waveAnimationKeyframes} 1.8s linear infinite`,
    "@media": {
        "(prefers-reduced-motion: reduce)": {
            mask: "none",
            animation: "none",
        },
    },
});
