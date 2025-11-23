import {keyframes, style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/client/web/styles/core/styles_core.js";

const backdropFadeInKeyframes = keyframes({
    "0%": {
        backgroundColor: "transparent",
        backdropFilter: "blur(0px)",
    },
    "20%": {
        backgroundColor: colorSchemeVars["grey-0-opacity-20"],
        backdropFilter: "blur(0px)",
    },
    "100%": {
        backgroundColor: colorSchemeVars["grey-0-opacity-60"],
        backdropFilter: "blur(15px)",
    },
});

const backdropFadeOutKeyframes = keyframes({
    "0%": {
        backgroundColor: colorSchemeVars["grey-0-opacity-60"],
        backdropFilter: "blur(15px)",
    },
    "80%": {
        backgroundColor: colorSchemeVars["grey-0-opacity-20"],
        backdropFilter: "blur(0px)",
    },
    "100%": {
        backgroundColor: "transparent",
        backdropFilter: "blur(0px)",
    },
});

export const backdropFadeAnimationDurationMs = 250;

export const backdropFadeInClassName = style({
    animation: `${backdropFadeInKeyframes} ${backdropFadeAnimationDurationMs}ms ease-out both`,
});

export const backdropFadeOutClassName = style({
    animation: `${backdropFadeOutKeyframes} ${backdropFadeAnimationDurationMs}ms ease-in both`,
});

export const withPointerToolbarClassName = style({});
