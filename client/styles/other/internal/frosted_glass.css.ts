import {style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/client/styles/core/styles_core.js";

const blurRadiusRem = 1;

export const frostedGlassChromeBuggedContainerClassName = style({});

// A proper frosted glass effect is a bit tricky to get right. Our frosted
// glass effect is based on Josh Comeau's tutorial on the topic:
// https://www.joshwcomeau.com/css/backdrop-filter
export const frostedGlassClassName = style({
    selectors: {
        "&::after": {
            content: '""',
            zIndex: "-10",
            pointerEvents: "none",
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: `calc(100% + ${blurRadiusRem}rem)`,
            background: `linear-gradient(to bottom, ${colorSchemeVars["grey-0"]}, ${colorSchemeVars["grey-0-opacity-80"]} calc(100% - ${blurRadiusRem}rem))`,
            backdropFilter: `blur(${blurRadiusRem}rem)`,
            maskImage: `linear-gradient(to bottom, black 0% calc(100% - ${blurRadiusRem}rem), transparent calc(100% - ${blurRadiusRem}rem) 100%)`,
        },
        [`:root[data-engine=blink] ${frostedGlassChromeBuggedContainerClassName} &::after`]: {
            height: "100%",
            background: `linear-gradient(to bottom, ${colorSchemeVars["grey-0"]}, ${colorSchemeVars["grey-0-opacity-80"]} 100%)`,
            backdropFilter: `blur(${blurRadiusRem}rem)`,
            maskImage: "none",
        },
    },
});
