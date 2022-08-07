import {assert} from "~/shared/helpers/control/assert";

/**
 * The size of 1rem in pixels based on platform.
 *
 * Mobile is 1.25x the size of desktop.
 */
export const remPx = {
    desktop: 16,
    mobile: 20,
} as const;

/**
 * Our spacing scale.
 *
 * The spacing scale is based on multiples of 8. Intervals increase
 * exponentially between steps on the scale.
 *
 * On mobile we scale everything up by 1.25x. This makes clickable areas larger
 * on mobile and helps legibility.
 *
 * The name of the spacing variable is proportional to its size. So `spacing32`
 * is four times as large as `spacing8`.
 *
 * We use rems to represent our spacing scale. This allows us to easily adjust
 * the platform scale.
 */
export const spacing = {
    "0": "0rem",
    "0.5": "0.125rem",
    "1": "0.25rem",
    "1.5": "0.375rem",
    "2": "0.5rem",
    "3": "0.75rem",
    "4": "1rem",
    "5": "1.25rem",
    "6": "1.5rem",
    "7": "1.75rem",
    "8": "2rem",
    "12": "3rem",
    "16": "4rem",
    "24": "6rem",
    "32": "8rem",
    "48": "12rem",
    "64": "16rem",
    "96": "24rem",
    "128": "32rem",
    "160": "40rem",
    "192": "48rem",
    "256": "64rem",
    "320": "80rem",
} as const;

export type RemLength = `${number}rem`;

/**
 * Convert a length in rem units to a number using the root font size pixel
 * value.
 */
export function convertRemLengthToPx(remLength: RemLength, remPx: number): number {
    assert(remLength.endsWith("rem"));
    const remLengthNumber = parseFloat(remLength.slice(0, -3));
    assert(!isNaN(remLengthNumber));
    return remLengthNumber * remPx;
}
