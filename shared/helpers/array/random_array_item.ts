import {assert} from "~/shared/helpers/control/assert.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";

/**
 * Chooses a random item in a non-empty array. If the array is empty, this function
 * will throw.
 *
 * Does not use a cryptographically secure random number generator!
 */
export function randomArrayItem<T>(array: ReadonlyArray<T>): T {
    assert(array.length > 0);
    return array[randomInteger(array.length)]!;
}
