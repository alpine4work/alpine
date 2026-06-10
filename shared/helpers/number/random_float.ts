import {lerp} from "~/shared/helpers/number/lerp.js";

/**
 * Generates a random float between `a` and `b` (exclusive).
 *
 * If `b` is not defined, generates a random float between 0 and `a` (exclusive).
 *
 * Does not use a cryptographically secure random number generator!
 */
export function randomFloat(a: number, b?: number) {
    if (typeof b === "number") {
        return lerp(a, b, Math.random());
    }
    return lerp(0, a, Math.random());
}
