import {invLerp} from "~/shared/helpers/number/inv_lerp.js";
import {lerp} from "~/shared/helpers/number/lerp.js";

/**
 * Maps number `n` from the range `a1`-`b1` to `a2`-`b2`. @example mapRange(1, 10,
 * 10, 100, 5) // 50
 */
export function mapRange(a1: number, b1: number, a2: number, b2: number, n: number): number {
    return lerp(a2, b2, invLerp(a1, b1, n));
}
