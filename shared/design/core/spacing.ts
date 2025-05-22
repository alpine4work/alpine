import {Memo} from "react";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getObjectEntriesWithKeyofType} from "~/shared/helpers/object/get_object_entries_with_keyof_type.js";

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
 * The name of the spacing variable is proportional to its size. So `32`
 * is four times as large as `8`.
 *
 * We use rems to represent our spacing scale. This allows us to easily adjust
 * the platform scale.
 *
 * Important values:
 *
 * - Our default font size (`75`) has a line height of `4`
 * - As a general rule, buttons should have a hit region of at least `9` (aka
 *   45px on mobile, [Apple recommends a 44px minimum hit region][1])
 * - Peek content typically has a width of `128`
 *
 * [1]: https://developer.apple.com/design/human-interface-guidelines/buttons
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
    "13": "3.25rem",
    "14": "3.5rem",
    "16": "4rem",
    "20": "5rem",
    "24": "6rem",
    "28": "7rem",
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

export function assertSpacing(string: string | number): Spacing {
    if (typeof string === "number") string = `${string}`;
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

const precomputedRemLengthNumberBySpacingRemLength = new Map<RemLength | Spacing, number>(
    getObjectEntriesWithKeyofType(spacing).flatMap(([spacing, remLength]) => [
        [remLength, parseFloat(remLength.slice(0, -3))],
        [spacing, parseFloat(remLength.slice(0, -3))],
    ]),
);

export type ParsableRemLength = Spacing | RemLength | `-${Spacing}` | `-${RemLength}`;

/**
 * Parses a length in rem units to the underlying rem value.
 */
export function parseRemLength(remLength: ParsableRemLength): number {
    if (remLength[0] === "-") return -parseRemLength(remLength.slice(1) as Spacing | RemLength);

    // Optimization: We've precomputed the rem length number for all `spacing`
    // values.
    const precomputedRemLengthNumber = precomputedRemLengthNumberBySpacingRemLength.get(
        remLength as Spacing | RemLength,
    );
    if (precomputedRemLengthNumber !== undefined) return precomputedRemLengthNumber;

    // `Spacing` values should never arrive here. They should be handled by
    // `precomputedRemLengthNumberBySpacingRemLength`.
    assert(remLength.endsWith("rem"));

    const remLengthNumber = parseFloat(remLength.slice(0, -3));
    assert(!isNaN(remLengthNumber));
    return remLengthNumber;
}

/**
 * Add two `RemLength`s together.
 */
export function addRemLengths(...remLengths: Array<ParsableRemLength>): RemLength {
    return `${remLengths.reduce(
        (totalRemLength, remLength) => totalRemLength + parseRemLength(remLength),
        0,
    )}rem`;
}

/**
 * Subtract one `RemLength` from another.
 */
export function subtractRemLengths(
    remLength1: ParsableRemLength,
    ...remLengths: Array<ParsableRemLength>
): RemLength {
    return `${remLengths.reduce(
        (totalRemLength, remLength) => totalRemLength - parseRemLength(remLength),
        parseRemLength(remLength1),
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
export function convertRemLengthToPx(
    remLength: ParsableRemLength,
    spacingScale: SpacingScale,
): number {
    return parseRemLength(remLength) * remPxBySpacingScale[spacingScale];
}

/**
 * Horizontal padding to use at the screen's edges. We use a different value on
 * the mobile platform vs desktop. Desktop UI in a mobile layout (peeks) will
 * still use desktop screen padding for consistency. There's less padding on
 * mobile since there's less available screen space. On desktop, even in peeks,
 * there's more screen space so adding padding improves legibility.
 */
export const screenPaddingX: Memo<{
    readonly mobile: Spacing;
    readonly desktop: Spacing;
}> = {
    mobile: "3",
    desktop: "5",
} as Memo<{
    readonly mobile: Spacing;
    readonly desktop: Spacing;
}>;

export const screenPaddingXRem: {
    readonly mobile: number;
    readonly desktop: number;
} = {
    mobile: parseRemLength(screenPaddingX.mobile),
    desktop: parseRemLength(screenPaddingX.desktop),
};
