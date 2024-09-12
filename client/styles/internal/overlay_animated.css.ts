import {keyframes, style} from "@vanilla-extract/css";
import {easeInOutQuad} from "~/shared/design/easing.js";
import {spacing} from "~/shared/design/spacing.js";

// On fade-in the animation moves towards the component. This makes it feel like
// the overlay is "pulled in" to the target.
//
// This is opposed to the fade-out animation moving away from the component
// making it feel like the overlay is coming out of the target.

const overlayFadeInTopKeyframes = keyframes({
    from: {opacity: 0, transform: `translateY(-${spacing["1"]})`},
    to: {opacity: 1, transform: "translateY(0)"},
});

const overlayFadeOutTopKeyframes = keyframes({
    from: {opacity: 1, transform: "translateY(0)"},
    to: {opacity: 0, transform: `translateY(-${spacing["1"]})`},
});

const overlayFadeInBottomKeyframes = keyframes({
    from: {opacity: 0, transform: `translateY(${spacing["1"]})`},
    to: {opacity: 1, transform: "translateY(0)"},
});

const overlayFadeOutBottomKeyframes = keyframes({
    from: {opacity: 1, transform: "translateY(0)"},
    to: {opacity: 0, transform: `translateY(${spacing["1"]})`},
});

const overlayFadeInLeftKeyframes = keyframes({
    from: {opacity: 0, transform: `translateX(-${spacing["1"]})`},
    to: {opacity: 1, transform: "translateX(0)"},
});

const overlayFadeOutLeftKeyframes = keyframes({
    from: {opacity: 1, transform: "translateX(0)"},
    to: {opacity: 0, transform: `translateX(-${spacing["1"]})`},
});

const overlayFadeInRightKeyframes = keyframes({
    from: {opacity: 0, transform: `translateX(${spacing["1"]})`},
    to: {opacity: 1, transform: "translateX(0)"},
});

const overlayFadeOutRightKeyframes = keyframes({
    from: {opacity: 1, transform: "translateX(0)"},
    to: {opacity: 0, transform: `translateX(${spacing["1"]})`},
});

export const overlayFadeInAnimationDurationMs = 100;
export const overlayFadeOutAnimationDurationMs = 200;

export const overlayFadeInOutTimingFunction = easeInOutQuad.cubicBezier;

// We use this instead of `overlayClassName` for other overlays that want to
// use the animation. If this becomes a common animation, we should figure out
// a better abstraction.
export const overlayAnimateContainerClassName = style({});

export const overlayAnimateFadeInFromBottomAnimation = `${overlayFadeInBottomKeyframes} ${overlayFadeInAnimationDurationMs}ms ${overlayFadeInOutTimingFunction} forwards`;
export const overlayAnimateFadeInFromBottomSlowedAnimation = `${overlayFadeInBottomKeyframes} ${overlayFadeOutAnimationDurationMs}ms ${overlayFadeInOutTimingFunction} forwards`;

export const overlayAnimateFadeInClassName = style({
    pointerEvents: "none",
    selectors: {
        [`${overlayAnimateContainerClassName}[data-popper-placement^=top] > &`]: {
            animation: `${overlayFadeInTopKeyframes} ${overlayFadeInAnimationDurationMs}ms ${overlayFadeInOutTimingFunction} forwards`,
        },
        [`${overlayAnimateContainerClassName}[data-popper-placement^=bottom] > &`]: {
            animation: overlayAnimateFadeInFromBottomAnimation,
        },
        [`${overlayAnimateContainerClassName}[data-popper-placement^=left] > &`]: {
            animation: `${overlayFadeInLeftKeyframes} ${overlayFadeInAnimationDurationMs}ms ${overlayFadeInOutTimingFunction} forwards`,
        },
        [`${overlayAnimateContainerClassName}[data-popper-placement^=right] > &`]: {
            animation: `${overlayFadeInRightKeyframes} ${overlayFadeInAnimationDurationMs}ms ${overlayFadeInOutTimingFunction} forwards`,
        },
    },
});

export const overlayAnimateFadeOutFromBottomAnimation = `${overlayFadeOutBottomKeyframes} ${overlayFadeOutAnimationDurationMs}ms ${overlayFadeInOutTimingFunction} forwards`;

export const overlayAnimateFadeOutClassName = style({
    pointerEvents: "none",
    selectors: {
        [`${overlayAnimateContainerClassName}[data-popper-placement^=top] > &`]: {
            animation: `${overlayFadeOutTopKeyframes} ${overlayFadeOutAnimationDurationMs}ms ${overlayFadeInOutTimingFunction} forwards`,
        },
        [`${overlayAnimateContainerClassName}[data-popper-placement^=bottom] > &`]: {
            animation: overlayAnimateFadeOutFromBottomAnimation,
        },
        [`${overlayAnimateContainerClassName}[data-popper-placement^=left] > &`]: {
            animation: `${overlayFadeOutLeftKeyframes} ${overlayFadeOutAnimationDurationMs}ms ${overlayFadeInOutTimingFunction} forwards`,
        },
        [`${overlayAnimateContainerClassName}[data-popper-placement^=right] > &`]: {
            animation: `${overlayFadeOutRightKeyframes} ${overlayFadeOutAnimationDurationMs}ms ${overlayFadeInOutTimingFunction} forwards`,
        },
    },
});
