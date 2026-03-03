import {keyframes, style} from "@vanilla-extract/css";
import {easeInOutCirc} from "~/shared/design/core/easing.js";
import {parseRemLength} from "~/shared/design/core/spacing.js";

const overlayArrowUpRightAnimationDistance = `${parseRemLength("0.5") * 1.5}rem`;

const overlayArrowUpRightAnimationKeyframes = keyframes({
    "0%": {
        transform: "translate(0, 0)",
    },
    "50%": {
        transform: `translate(${overlayArrowUpRightAnimationDistance}, -${overlayArrowUpRightAnimationDistance})`,
    },
    "100%": {
        transform: "translate(0, 0)",
    },
});

// Don't make the user wait too long before they see the animation again. They may
// see the animation once out of the corner of their eye, then focus in. If they
// stare at the button for a while they may be frustrated if it doesn't move.
export const overlayArrowUpRightAnimationDelay = 2250;

export const overlayArrowUpRightAnimationDuration = 750;

export const overlayArrowUpRightAnimationClassName = style({
    animation: `${overlayArrowUpRightAnimationDuration}ms ${easeInOutCirc.cubicBezier} ${overlayArrowUpRightAnimationKeyframes}`,
});
