import {keyframes} from "@vanilla-extract/css";
import {createSpringAnimation} from "~/client/web/styles/other/internal/helpers/spring_animation.js";
import {easeInOutQuad} from "~/shared/design/core/easing.js";

const offset = 1.5;

const pullKeyframes = keyframes({
    from: {transform: "translate(0rem, 0rem)"},
    to: {transform: `translate(${offset}rem, 0rem)`},
});

const pullDuration = 160;

const {animationKeyframes: springKeyframes, animationDuration: springDuration} =
    createSpringAnimation({
        startX: offset,
        startY: 0,
        endX: 0,
        endY: 0,
        units: "rem",
        tension: 260,
        friction: 10,
    });

/**
 * To highlight a message for the user on page load or after jump scrolling to the
 * message we wiggle the message horizontally a bit. We choose this as the way to
 * highlight a message because:
 *
 * - It is temporary
 * - Movement catches the user's attention (maybe better than color would)
 * - It doesn't break the product's physics like shaking (rotating) might
 * - Message already moves horizontally when slid with touch
 *
 * The animation has two parts:
 *
 * 1. The pull
 * 2. Spring physics
 *
 * First we pull the message away from its resting position then a spring brings it
 * back.
 *
 * We use a high tension low friction spring. The message really wants to go back
 * to its resting position (high tension) but it overshoots (low friction). The low
 * friction surface is supported by the fact the user can drag the message with no
 * resistance with their finger.
 *
 * To simulate a pull we use an ease-in-out animation. We need to ease-in since the
 * object needs to build momentum, then we need to ease-out since the object needs
 * to lose the momentum it gained.
 *
 * This animation was initially built for highlighting a message but since has been
 * expanded for use in other places.
 */
export const wiggleAnimation = `${pullKeyframes} ${pullDuration}ms ${easeInOutQuad.cubicBezier} forwards, ${springKeyframes} ${springDuration}ms linear ${pullDuration}ms forwards`;

export const wiggleAnimationDuration = pullDuration + springDuration;
