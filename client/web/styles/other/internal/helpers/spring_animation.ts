import {keyframes} from "@vanilla-extract/css";

/**
 * Creates an animation that uses spring physics run by CSS animations. Running
 * a spring animation with CSS animations is more efficient than approaches
 * like [`react-spring`][1] which run animations in JavaScript and so are
 * limited by JavaScript main thread performance.
 *
 * Our code is derived from [this blog post][2]. To pick `stiffness` and
 * `damping` values we recommend starting with [`react-spring`
 * configurations][3].
 *
 * [1]: https://www.npmjs.com/package/react-spring
 * [2]: https://www.kirillvasiltsov.com/writing/how-to-create-a-spring-animation-with-web-animation-api/
 * [3]: https://github.com/pmndrs/react-spring/blob/07b229cf03507de1c66e2ffd1e7d8c617fcb3f61/packages/core/src/constants.ts#L1-L9
 */
// TODO(calebmer): We could use `motion` now instead of writing our own spring
// CSS generator!
// https://motion.dev/docs/css
export function createSpringAnimation({
    startX = 0,
    startY = 0,
    endX = 0,
    endY = 0,
    units,
    tension,
    friction,
    mass = 1,
}: {
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
    units: "px" | "rem" | "%";
    tension: number;
    friction: number;
    mass?: number;
}) {
    const springLength = 0;
    const k = -tension;
    const d = -friction;

    const frameRate = 1 / 60;
    const displacementThreshold = {px: 0.5, rem: 0.03, "%": 0.1}[units];
    let framesBelowDisplacementThreshold = 0;

    const positions = [];

    const distanceX = endX - startX;
    const distanceY = endY - startY;

    let x = distanceX;
    let y = distanceY;

    let velocityX = 0;
    let velocityY = 0;

    positions.push({transform: `translate(${startX}${units}, ${startY}${units})`});

    for (let step = 0; step <= 1000; step += 1) {
        const fSpringX = k * (x - springLength);
        const fSpringY = k * (y - springLength);
        const fDampingX = d * velocityX;
        const fDampingY = d * velocityY;

        const accelerationX = (fSpringX + fDampingX) / mass;
        const accelerationY = (fSpringY + fDampingY) / mass;

        velocityX += accelerationX * frameRate;
        velocityY += accelerationY * frameRate;

        x += velocityX * frameRate;
        y += velocityY * frameRate;

        positions.push({transform: `translate(${endX - x}${units}, ${endY - y}${units})`});

        const displacement = Math.hypot(x, y);

        if (Math.abs(displacement) < displacementThreshold) {
            framesBelowDisplacementThreshold += 1;
        } else {
            framesBelowDisplacementThreshold = 0; // Reset the frame counter
        }

        if (framesBelowDisplacementThreshold >= 10) {
            break;
        }
    }

    positions.push({transform: `translate(${endX}${units}, ${endY}${units})`});

    const duration = ((positions.length - 1) / 60) * 1000;

    const springKeyframes = keyframes(
        Object.fromEntries(
            positions.map((keyframe, index) => [
                `${(index / (positions.length - 1)) * 100}%`,
                keyframe,
            ]),
        ),
    );

    return {
        animationDuration: duration,
        animationKeyframes: springKeyframes,
        animation: `${springKeyframes} ${duration}ms linear both`,
        animationPositions: positions,
    };
}
