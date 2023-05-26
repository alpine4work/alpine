import {assert} from "~/shared/helpers/control/assert";

/**
 * The size of 1rem in pixels based on platform.
 *
 * Mobile is 1.25x the size of desktop.
 */
export const remPxByPlatform = {
    desktop: 16,
    mobile: 20,
} as const;

/**
 * The maximum screen width for our mobile platform in pixels.
 */
export const mobileMaxScreenWidth = 768;

/**
 * Get the size of 1rem for the screen width.
 */
export function getRemPxFromWindowWidth(windowWidth: number) {
    return windowWidth <= mobileMaxScreenWidth ? remPxByPlatform.mobile : remPxByPlatform.desktop;
}

/**
 * CSS media query which when true tells us to use the mobile rem size instead
 * of desktop rem size from `remPxByPlatform`.
 */
export const mobilePlatformMediaQuery = `screen and (max-width: ${mobileMaxScreenWidth}px)`;

/**
 * CSS media query which will match desktop and not mobile.
 */
export const desktopPlatformMediaQuery = `screen and (min-width: ${
    // `min-width` is inclusive but we don't want to include the mobile max width.
    // In case there are fractional pixels add a small fraction.
    mobileMaxScreenWidth + 0.1
}px)`;

export type Spacing = keyof typeof spacing;

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
    "2.5": "0.625rem",
    "3": "0.75rem",
    "4": "1rem",
    "5": "1.25rem",
    "6": "1.5rem",
    "7": "1.75rem",
    "8": "2rem",
    "9": "2.25rem",
    "10": "2.5rem",
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

export function isSpacing(string: string): string is Spacing {
    return string in spacing;
}

export function assertSpacing(string: string): Spacing {
    assert(isSpacing(string));
    return string;
}

export type RemLength = `${number}rem` | `-${number}rem`;

/**
 * Is the provided string a `RemLength` string?
 */
export function isRemLength(string: string): string is RemLength {
    if (!string.endsWith("rem")) return false;
    const remLengthNumber = parseFloat(string.slice(0, -3));
    if (isNaN(remLengthNumber)) return false;
    return true;
}

/**
 * Parses a length in rem units to the underlying rem value.
 */
export function parseRemLengthNumber(remLength: RemLength): number {
    assert(remLength.endsWith("rem"));
    const remLengthNumber = parseFloat(remLength.slice(0, -3));
    assert(!isNaN(remLengthNumber));
    return remLengthNumber;
}

/**
 * Add two `RemLength`s together.
 */
export function addRemLengths(...remLengths: Array<RemLength>): RemLength {
    return `${remLengths.reduce(
        (totalRemLength, remLength) => totalRemLength + parseRemLengthNumber(remLength),
        0,
    )}rem`;
}

/**
 * Flips a positive `RemLength` to a negative `RemLength` and flips a negative
 * `RemLength` to a positive `RemLength`.
 */
export function negateRemLength(remLength: RemLength): RemLength {
    if (remLength.startsWith("-")) return remLength.slice(1) as RemLength;
    return ("-" + remLength) as RemLength;
}

/**
 * Convert a length in rem units to a number using the root font size pixel
 * value.
 */
export function convertRemLengthToPx(remLength: RemLength, remPx: number): number {
    return parseRemLengthNumber(remLength) * remPx;
}
