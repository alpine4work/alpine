import {style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/client/styles/core/styles_core.js";

const blurRadiusRem = 1;

// A proper frosted glass effect is a bit tricky to get right. Our frosted
// glass effect is based on Josh Comeau's tutorial on the topic:
// https://www.joshwcomeau.com/css/backdrop-filter
export const frostedGlassClassName = style({
    selectors: {
        "&::after": {
            content: '""',
            zIndex: -20,
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "200%",
            background: `linear-gradient(to bottom, ${colorSchemeVars["grey-0"]}, ${colorSchemeVars["grey-0-opacity-60"]} 50%)`,
            backdropFilter: `blur(${blurRadiusRem}rem)`,
            maskImage: "linear-gradient(to bottom, black 0% 50%, transparent 50% 100%)",
        },
    },
});
