/**
 * Clamps a number to be between a minimum and maximum value.
 */
export function clamp(min: number, number: number, max: number): number {
    if (number < min) return min;
    if (number > max) return max;
    return number;
}
