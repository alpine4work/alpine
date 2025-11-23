import {createSpringAnimation} from "~/client/web/styles/other/internal/helpers/spring_animation.js";

// Have the offscreen Y position be a bit more than 100% because we want to
// create the illusion of the toast being thrown from offscreen.
const offscreenY = 110;

export const {animation: toastAnimateInAnimation} = createSpringAnimation({
    startX: 0,
    startY: offscreenY,
    endX: 0,
    endY: 0,
    units: "%",
    tension: 210,
    friction: 20,
});

export const {animation: toastAnimateOutAnimation, animationDuration: toastAnimateOutDuration} =
    createSpringAnimation({
        startX: 0,
        startY: 0,
        endX: 0,
        endY: offscreenY,
        units: "%",
        tension: 210,
        friction: 20,
    });
