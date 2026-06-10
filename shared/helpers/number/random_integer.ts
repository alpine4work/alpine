import {randomFloat} from "~/shared/helpers/number/random_float.js";

/**
 * Generates a random integer between `a` and `b` (exclusive).
 *
 * If `b` is not defined, generates a random integer between 0 and `a` (exclusive).
 *
 * Does not use a cryptographically secure random number generator!
 */
export function randomInteger(a: number, b?: number) {
    return Math.floor(randomFloat(a, b));
}
