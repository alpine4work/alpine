import {keyframes} from "@vanilla-extract/css";
import {spacing} from "~/shared/design/spacing";

export const modalUnderlayOpacity = 0.6;

const modalUnderlayFadeInKeyframes = keyframes({
    from: {opacity: 0},
    to: {opacity: modalUnderlayOpacity},
});

const modalOverlayFadeInKeyframes = keyframes({
    from: {opacity: 0, transform: `translateY(${spacing["1"]}) scale(0.98)`},
    to: {opacity: 1, transform: "translateY(0) scale(1)"},
});

const modalContentFadeInKeyframes = keyframes({
    from: {opacity: 0},
    to: {opacity: 1},
});

export const modalUnderlayFadeInAnimation = `${modalUnderlayFadeInKeyframes} 280ms ease-out both`;

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
