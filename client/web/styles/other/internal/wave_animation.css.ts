import {keyframes, style} from "@vanilla-extract/css";
import {backgroundColorVar} from "~/client/web/styles/core/styles_core.js";

// Shimmer effect for AI thinking indicators. Derived from:
// https://npmjs.com/tw-shimmer

const trackHeightRem = 12.5;
const angleDeg = 15;

const waveAnimationKeyframes = keyframes({
    from: {backgroundPosition: "100% 0"},
});

export const waveAnimationClassName = style({
    position: "relative",
    zIndex: 0,
    vars: {
        "--_speed": "200",
        "--_spread": "calc(4ch + 5rem)",
        "--_bg": `rgb(from ${backgroundColorVar} r g b / 0%)`,
        "--_fg": `rgb(from ${backgroundColorVar} r g b / 70%)`,

        "--_gradient-width": `calc(var(--_spread) + ${trackHeightRem}rem * tan(${angleDeg}deg))`,
        "--_active-distance": `calc(12.5rem + var(--_gradient-width))`,
        "--_duration": `calc(var(--_active-distance) / var(--_speed) / 1px * 1000)`,
        "--_repeat-delay": `calc(20000 / var(--_speed))`,
        "--_repeat-delay-px": `calc(var(--_repeat-delay) * var(--_active-distance) / var(--_duration))`,

        "--_bg-width": `calc(200% + var(--_gradient-width) + var(--_repeat-delay-px))`,

        "--_position":
            `calc(` +
            `((100% - var(--_gradient-width) - var(--_repeat-delay-px)) / 2) + ` +
            `var(--_gradient-width) / 2 + ` +
            `var(--_repeat-delay-px)` +
            `)`,

        // Use a sine ease-in-out curve (17 stops) for smooth falloff
        "--_mix-96": "color-mix(in oklch, var(--_fg), var(--_bg) 96%)",
        "--_mix-83": "color-mix(in oklch, var(--_fg), var(--_bg) 83%)",
        "--_mix-67": "color-mix(in oklch, var(--_fg), var(--_bg) 67%)",
        "--_mix-50": "color-mix(in oklch, var(--_fg), var(--_bg) 50%)",
        "--_mix-33": "color-mix(in oklch, var(--_fg), var(--_bg) 33%)",
        "--_mix-17": "color-mix(in oklch, var(--_fg), var(--_bg) 17%)",
        "--_mix-4": "color-mix(in oklch, var(--_fg), var(--_bg) 4%)",
    },
    selectors: {
        "&::after": {
            content: '""',
            position: "absolute",
            inset: 0,
            zIndex: 1,
            background: `linear-gradient(${[
                `calc(90deg + ${angleDeg}deg)`,
                `var(--_bg) calc(var(--_position) - var(--_spread) * 0.5)`,
                `var(--_mix-96) calc(var(--_position) - var(--_spread) * 0.44)`,
                `var(--_mix-83) calc(var(--_position) - var(--_spread) * 0.37)`,
                `var(--_mix-67) calc(var(--_position) - var(--_spread) * 0.31)`,
                `var(--_mix-50) calc(var(--_position) - var(--_spread) * 0.25)`,
                `var(--_mix-33) calc(var(--_position) - var(--_spread) * 0.19)`,
                `var(--_mix-17) calc(var(--_position) - var(--_spread) * 0.12)`,
                `var(--_mix-4) calc(var(--_position) - var(--_spread) * 0.06)`,
                `var(--_fg) var(--_position)`,
                `var(--_mix-4) calc(var(--_position) + var(--_spread) * 0.06)`,
                `var(--_mix-17) calc(var(--_position) + var(--_spread) * 0.12)`,
                `var(--_mix-33) calc(var(--_position) + var(--_spread) * 0.19)`,
                `var(--_mix-50) calc(var(--_position) + var(--_spread) * 0.25)`,
                `var(--_mix-67) calc(var(--_position) + var(--_spread) * 0.31)`,
                `var(--_mix-83) calc(var(--_position) + var(--_spread) * 0.37)`,
                `var(--_mix-96) calc(var(--_position) + var(--_spread) * 0.44)`,
                `var(--_bg) calc(var(--_position) + var(--_spread) * 0.5)`,
            ].join(", ")}) 0 0 / var(--_bg-width) 100% no-repeat`,
            animation: `${waveAnimationKeyframes} 1s linear 0s infinite backwards`,
            animationDuration: `calc((var(--_duration) + var(--_repeat-delay)) * 1ms)`,
        },
    },
});
