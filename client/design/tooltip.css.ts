import {keyframes, style} from "@vanilla-extract/css";
import {spacing} from "~/shared/design/spacing";

// On fade-in the animation moves towards the component. This makes it feel like
// the tooltip is "pulled in" to the target.
//
// This is opposed to the fade-out animation moving away from the component
// making it feel like the tooltip is coming out of the target.

const tooltipFadeInTopKeyframes = keyframes({
    from: {opacity: 0, transform: `translateY(-${spacing["1"]})`},
    to: {opacity: 1, transform: "translateY(0)"},
});

const tooltipFadeOutTopKeyframes = keyframes({
    from: {opacity: 1, transform: "translateY(0)"},
    to: {opacity: 0, transform: `translateY(-${spacing["1"]})`},
});

const tooltipFadeInBottomKeyframes = keyframes({
    from: {opacity: 0, transform: `translateY(${spacing["1"]})`},
    to: {opacity: 1, transform: "translateY(0)"},
});

const tooltipFadeOutBottomKeyframes = keyframes({
    from: {opacity: 1, transform: "translateY(0)"},
    to: {opacity: 0, transform: `translateY(${spacing["1"]})`},
});

const tooltipFadeInLeftKeyframes = keyframes({
    from: {opacity: 0, transform: `translateX(-${spacing["1"]})`},
    to: {opacity: 1, transform: "translateX(0)"},
});

const tooltipFadeOutLeftKeyframes = keyframes({
    from: {opacity: 1, transform: "translateX(0)"},
    to: {opacity: 0, transform: `translateX(-${spacing["1"]})`},
});

const tooltipFadeInRightKeyframes = keyframes({
    from: {opacity: 0, transform: `translateX(${spacing["1"]})`},
    to: {opacity: 1, transform: "translateX(0)"},
});

const tooltipFadeOutRightKeyframes = keyframes({
    from: {opacity: 1, transform: "translateX(0)"},
    to: {opacity: 0, transform: `translateX(${spacing["1"]})`},
});

// TODO(calebmer): Make this a constant somewhere in `shared/styles`.
export const tooltipFadeAnimationDurationMs = 200;

// TODO(calebmer): Make this a constant somewhere in `shared/styles`.
const tooltipFadeInOutTimingFunction = "cubic-bezier(0.4, 0, 0.2, 1)";

// We use this instead of `tooltipClassName` for other overlays that want to
// use the animation. If this becomes a common animation, we should figure out
// a better abstraction.
export const tooltipAnimateContainerClassName = style({});

export const tooltipAnimateFadeInClassName = style({
    selectors: {
        [`${tooltipAnimateContainerClassName}[data-popper-placement^=top] &`]: {
            animation: `${tooltipFadeInTopKeyframes} ${tooltipFadeAnimationDurationMs}ms ${tooltipFadeInOutTimingFunction} forwards`,
        },
        [`${tooltipAnimateContainerClassName}[data-popper-placement^=bottom] &`]: {
            animation: `${tooltipFadeInBottomKeyframes} ${tooltipFadeAnimationDurationMs}ms ${tooltipFadeInOutTimingFunction} forwards`,
        },
        [`${tooltipAnimateContainerClassName}[data-popper-placement^=left] &`]: {
            animation: `${tooltipFadeInLeftKeyframes} ${tooltipFadeAnimationDurationMs}ms ${tooltipFadeInOutTimingFunction} forwards`,
        },
        [`${tooltipAnimateContainerClassName}[data-popper-placement^=right] &`]: {
            animation: `${tooltipFadeInRightKeyframes} ${tooltipFadeAnimationDurationMs}ms ${tooltipFadeInOutTimingFunction} forwards`,
        },
    },
});

export const tooltipAnimateFadeOutClassName = style({
    selectors: {
        [`${tooltipAnimateContainerClassName}[data-popper-placement^=top] &`]: {
            animation: `${tooltipFadeOutTopKeyframes} ${tooltipFadeAnimationDurationMs}ms ${tooltipFadeInOutTimingFunction} forwards`,
        },
        [`${tooltipAnimateContainerClassName}[data-popper-placement^=bottom] &`]: {
            animation: `${tooltipFadeOutBottomKeyframes} ${tooltipFadeAnimationDurationMs}ms ${tooltipFadeInOutTimingFunction} forwards`,
        },
        [`${tooltipAnimateContainerClassName}[data-popper-placement^=left] &`]: {
            animation: `${tooltipFadeOutLeftKeyframes} ${tooltipFadeAnimationDurationMs}ms ${tooltipFadeInOutTimingFunction} forwards`,
        },
        [`${tooltipAnimateContainerClassName}[data-popper-placement^=right] &`]: {
            animation: `${tooltipFadeOutRightKeyframes} ${tooltipFadeAnimationDurationMs}ms ${tooltipFadeInOutTimingFunction} forwards`,
        },
    },
});
