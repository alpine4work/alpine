import {createVar, globalStyle, keyframes, style} from "@vanilla-extract/css";
import {CssVarFunction, darkColorSchemeSelector} from "~/client/web/styles/core/styles_core.js";
import {spacing} from "~/shared/design/core/spacing.js";

export const modalContainerClassName = style({});

export const modalUnderlayOpacityVar: CssVarFunction = createVar("modal-underlay-opacity");

globalStyle(":root", {
    vars: {
        [modalUnderlayOpacityVar]: "0.4",
    },
});

globalStyle(darkColorSchemeSelector, {
    vars: {
        [modalUnderlayOpacityVar]: "0.6",
    },
});

const modalUnderlayFadeInKeyframes = keyframes({
    from: {opacity: 0},
    to: {opacity: modalUnderlayOpacityVar},
});

const modalOverlayFadeInKeyframes = keyframes({
    from: {opacity: 0, transform: `translateY(${spacing["1"]}) scale(0.98)`},
    to: {opacity: 1, transform: "translateY(0) scale(1)"},
});

const modalContentFadeInKeyframes = keyframes({
    from: {opacity: 0},
    to: {opacity: 1},
});

// We follow an animation principle of: respond to direct user interaction
// immediately, respond to indirect user interaction with animation. We consider a
// modal to be a result of an indirect interaction. The user's cursor is likely not
// near the center of the screen where the modal buttons are.
//
// Because the modal takes over the entire screen and is spatially disconnected
// from the element which spawned it, we use a slightly longer animation.
export const modalUnderlayFadeInAnimation = `${modalUnderlayFadeInKeyframes} 240ms ease-out both`;

export const modalOverlayFadeInAnimation = `${modalOverlayFadeInKeyframes} 144ms ease-out 32ms both`;

// Fade the content in after an empty shell. See reasoning here:
// https://twitter.com/joshwcomeau/status/1331746989588045831
export const modalContentFadeInAnimation = `${modalContentFadeInKeyframes} 160ms ease-out 48ms both`;

const modalFadeOutKeyframes = keyframes({
    from: {opacity: 1},
    to: {opacity: 0},
});

export const modalFadeOutDuration = 120;

export const modalFadeOutAnimation = `${modalFadeOutKeyframes} ${
    modalFadeOutDuration - 10
}ms linear 10ms both`;

export const modalContentFadeOutAnimation = `${modalFadeOutKeyframes} 70ms linear both`;
