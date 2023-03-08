import {keyframes} from "@vanilla-extract/css";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {createSpringAnimation} from "~/shared/styles/internal/spring_animation";

export const peekHeight = spacing["160"];

export const {animation: peekPushAnimation, animationDuration: peekPushAnimationDuration} =
    createSpringAnimation({
        startX: 0,
        startY: parseRemLengthNumber(peekHeight),
        endX: 0,
        endY: 0,
        units: "rem",
        tension: 250,
        friction: 28,
    });

export const peekUnderlayOffsetRem = parseRemLengthNumber(spacing["2"]);

const peekPushUnderlay0To1TranslateKeyframes = keyframes({
    from: {
        transform: `translate(${peekUnderlayOffsetRem * 0}rem, ${peekUnderlayOffsetRem * 0}rem)`,
    },
    to: {
        transform: `translate(${peekUnderlayOffsetRem * 1}rem, ${peekUnderlayOffsetRem * 1}rem)`,
    },
});

const peekPushUnderlay1To2TranslateKeyframes = keyframes({
    from: {
        transform: `translate(${peekUnderlayOffsetRem * 1}rem, ${peekUnderlayOffsetRem * 1}rem)`,
    },
    to: {
        transform: `translate(${peekUnderlayOffsetRem * 2}rem, ${peekUnderlayOffsetRem * 2}rem)`,
    },
});

const peekPushUnderlay2ToOutTranslateKeyframes = keyframes({
    from: {
        transform: `translate(${peekUnderlayOffsetRem * 2}rem, ${peekUnderlayOffsetRem * 2}rem)`,
    },
    to: {
        transform: `translate(${peekUnderlayOffsetRem * 3}rem, ${peekUnderlayOffsetRem * 3}rem)`,
    },
});

const peekPushUnderlay2ToOutOpacityKeyframes = keyframes({
    from: {opacity: 1},
    to: {opacity: 0},
});

const peekPushUnderlayTranslateAnimationDuration = 200;
const peekPushUnderlayTranslateOpacityDelay = 100;
const peekPushUnderlayTranslateOpacityDuration = 400;

export const peekPushUnderlayAnimationTotalDuration = Math.max(
    peekPushUnderlayTranslateAnimationDuration,
    peekPushUnderlayTranslateOpacityDelay + peekPushUnderlayTranslateOpacityDuration,
);

const peekUnderlayAnimationEasing = "ease-in-out";

export const peekPushUnderlay0To1Animation = `${peekPushUnderlay0To1TranslateKeyframes} ${peekPushUnderlayTranslateAnimationDuration}ms ${peekUnderlayAnimationEasing} both`;
export const peekPushUnderlay1To2Animation = `${peekPushUnderlay1To2TranslateKeyframes} ${peekPushUnderlayTranslateAnimationDuration}ms ${peekUnderlayAnimationEasing} both`;
export const peekPushUnderlay2ToOutAnimation = `${peekPushUnderlay2ToOutTranslateKeyframes} ${peekPushUnderlayTranslateAnimationDuration}ms ${peekUnderlayAnimationEasing} both, ${peekPushUnderlay2ToOutOpacityKeyframes} ${peekPushUnderlayTranslateOpacityDuration}ms linear ${peekPushUnderlayTranslateOpacityDelay}ms both`;

const peekPushUnderlayContentKeyframes = keyframes({
    from: {opacity: 1},
    to: {opacity: 0},
});

const peekPushUnderlayContentAnimationDelay = 300;
const peekPushUnderlayContentAnimationDuration = 300;
export const peekPushUnderlayContentAnimationTotalDuration =
    peekPushUnderlayContentAnimationDelay + peekPushUnderlayContentAnimationDuration;
export const peekPushUnderlayContentAnimation = `${peekPushUnderlayContentKeyframes} ${peekPushUnderlayContentAnimationDuration}ms ease-out ${peekPushUnderlayContentAnimationDelay}ms both`;

const {animationKeyframes: peekPopAnimationKeyframes, animationDuration: peekPopAnimationDuration} =
    createSpringAnimation({
        startX: 0,
        startY: 0,
        endX: 0,
        endY: parseRemLengthNumber(peekHeight) + peekUnderlayOffsetRem,
        units: "rem",
        tension: 280,
        friction: 28,
    });

const peekPopAnimationDurationDelay = 100;
export const peekPopAnimationTotalDuration =
    peekPopAnimationDurationDelay + peekPopAnimationDuration;
export const peekPopAnimation = `${peekPopAnimationKeyframes} ${peekPopAnimationDuration}ms linear ${peekPopAnimationDurationDelay}ms both`;

const peekPopUnderlay1To0TranslateKeyframes = keyframes({
    from: {
        transform: `translate(${peekUnderlayOffsetRem * 1}rem, ${peekUnderlayOffsetRem * 1}rem)`,
    },
    to: {
        transform: `translate(${peekUnderlayOffsetRem * 0}rem, ${peekUnderlayOffsetRem * 0}rem)`,
    },
});

const peekPopUnderlay2To1TranslateKeyframes = keyframes({
    from: {
        transform: `translate(${peekUnderlayOffsetRem * 2}rem, ${peekUnderlayOffsetRem * 2}rem)`,
    },
    to: {
        transform: `translate(${peekUnderlayOffsetRem * 1}rem, ${peekUnderlayOffsetRem * 1}rem)`,
    },
});

const peekPopUnderlayOutTo2TranslateKeyframes = keyframes({
    from: {
        transform: `translate(${peekUnderlayOffsetRem * 3}rem, ${peekUnderlayOffsetRem * 3}rem)`,
    },
    to: {
        transform: `translate(${peekUnderlayOffsetRem * 2}rem, ${peekUnderlayOffsetRem * 2}rem)`,
    },
});

const peekPopUnderlayOutTo2OpacityKeyframes = keyframes({
    from: {opacity: 0},
    to: {opacity: 1},
});

const peekPopUnderlayTranslateAnimationDuration = 200;
const peekPopUnderlayTranslateOpacityDuration = 200;

export const peekPopUnderlayAnimationTotalDuration = Math.max(
    peekPopAnimationDurationDelay + peekPopUnderlayTranslateAnimationDuration,
    peekPopAnimationDurationDelay + peekPopUnderlayTranslateOpacityDuration,
);

export const peekPopUnderlay1To0Animation = `${peekPopUnderlay1To0TranslateKeyframes} ${peekPopUnderlayTranslateAnimationDuration}ms ${peekUnderlayAnimationEasing} ${peekPopAnimationDurationDelay}ms both`;
export const peekPopUnderlay2To1Animation = `${peekPopUnderlay2To1TranslateKeyframes} ${peekPopUnderlayTranslateAnimationDuration}ms ${peekUnderlayAnimationEasing} ${peekPopAnimationDurationDelay}ms both`;
export const peekPopUnderlayOutTo2Animation = `${peekPopUnderlayOutTo2TranslateKeyframes} ${peekPopUnderlayTranslateAnimationDuration}ms ${peekUnderlayAnimationEasing} ${peekPopAnimationDurationDelay}ms both, ${peekPopUnderlayOutTo2OpacityKeyframes} ${peekPopUnderlayTranslateOpacityDuration}ms linear ${peekPopAnimationDurationDelay}ms both`;

const peekPopUnderlayContentKeyframes = keyframes({
    from: {opacity: 0},
    to: {opacity: 1},
});

export const peekPopUnderlayContentAnimationDuration = peekPopAnimationDurationDelay;
export const peekPopUnderlayContentAnimation = `${peekPopUnderlayContentKeyframes} ${peekPopUnderlayContentAnimationDuration}ms ease-out both`;
