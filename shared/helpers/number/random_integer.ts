import {randomFloat} from "~/shared/helpers/number/random_float";

/**
 * Generates a random integer between `a` and `b`.
 *
 * If `b` is not defined, generates a random integer between 0 and `a`.
 *
 * Does not use a cryptographically secure random number generator!
 */
export function randomInteger(a: number, b?: number) {
    return Math.floor(randomFloat(a, b));
}
