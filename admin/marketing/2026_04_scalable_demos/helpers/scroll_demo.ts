import {Locator} from "playwright";
import {InternalError} from "~/shared/error/error.open_source.js";

export type ScrollDemoOptions = {
    /**
     * The number of pixels to scroll. Positive values scroll down, negative values
     * scroll up. Defaults to almost two view heights.
     */
    readonly distance?: number;
    /** Absolute scroll top to animate to. Mutually exclusive with `distance`. */
    readonly targetScrollTop?: number;
    readonly durationMs?: number;
    /** Fraction of the animation spent building momentum from rest. */
    readonly accelerationPortion?: number;
    /**
     * Higher values spend more of the deceleration phase near the end position.
     */
    readonly decelerationExponent?: number;
};

/**
 * Scroll a demo surface with momentum that builds first, then decays slowly.
 */
export async function scrollDemo(
    locator: Locator,
    {
        distance,
        targetScrollTop,
        durationMs = 1700,
        accelerationPortion = 0.2,
        decelerationExponent = 3,
    }: ScrollDemoOptions = {},
): Promise<void> {
    if (distance !== undefined && targetScrollTop !== undefined) {
        throw new InternalError(
            "Pass either `distance` or `targetScrollTop` to scrollDemo(), not both",
        );
    }

    await locator.evaluate(
        (
            element,
            {distance, targetScrollTop, durationMs, accelerationPortion, decelerationExponent},
        ) => {
            const clamp = (min: number, value: number, max: number) =>
                Math.min(Math.max(value, min), max);

            const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
            const startScrollTop = element.scrollTop;
            const requestedDistance =
                targetScrollTop !== null
                    ? targetScrollTop - startScrollTop
                    : (distance ?? element.clientHeight * 1.8);
            const endScrollTop = clamp(0, startScrollTop + requestedDistance, maxScrollTop);
            const scrollDistance = endScrollTop - startScrollTop;

            if (Math.abs(scrollDistance) < 1) return;

            return new Promise<void>(resolve => {
                const startTime = performance.now();
                const duration = Math.max(1, durationMs);
                const accelerationSeconds =
                    (duration / 1000) * clamp(0.05, accelerationPortion, 0.6);
                const decelerationSeconds = Math.max(0.001, duration / 1000 - accelerationSeconds);
                const decelerationPower = clamp(1.5, decelerationExponent, 6);
                const acceleration = 1 / accelerationSeconds;
                const accelerationDistance = 0.5 * acceleration * accelerationSeconds ** 2;
                const decelerationDistance = decelerationSeconds / decelerationPower;
                const totalPhysicsDistance = accelerationDistance + decelerationDistance;

                const getProgress = (elapsedMs: number) => {
                    const elapsedSeconds = elapsedMs / 1000;

                    if (elapsedSeconds <= accelerationSeconds) {
                        return (0.5 * acceleration * elapsedSeconds ** 2) / totalPhysicsDistance;
                    }

                    const decelerationElapsedSeconds = Math.min(
                        decelerationSeconds,
                        elapsedSeconds - accelerationSeconds,
                    );
                    const decelerationProgress =
                        1 -
                        (1 - decelerationElapsedSeconds / decelerationSeconds) ** decelerationPower;

                    return (
                        (accelerationDistance + decelerationDistance * decelerationProgress) /
                        totalPhysicsDistance
                    );
                };

                function step(now: number) {
                    const elapsedMs = Math.min(now - startTime, duration);

                    if (elapsedMs >= duration) {
                        element.scrollTop = endScrollTop;
                        resolve();
                        return;
                    }

                    element.scrollTop = startScrollTop + scrollDistance * getProgress(elapsedMs);
                    requestAnimationFrame(step);
                }

                requestAnimationFrame(step);
            });
        },
        {
            distance: distance ?? null,
            targetScrollTop: targetScrollTop ?? null,
            durationMs,
            accelerationPortion,
            decelerationExponent,
        },
    );
}
