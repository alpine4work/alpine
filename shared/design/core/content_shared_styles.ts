import {parseRemLength, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";

// Content max width is spacing "160" (40rem). See `content.css.ts` for the
// canonical CSS definition.
const contentMaxWidthRem = parseRemLength(spacing["160"]);

/**
 * The maximum block width in rem for each platform. Derived from
 * `contentMaxWidth - screenPaddingX * 2`. See `content.css.ts` for the canonical
 * CSS definition.
 */
export const contentBlockMaxWidthRem = {
    mobile: contentMaxWidthRem - parseRemLength(screenPaddingX.mobile) * 2,
    desktop: contentMaxWidthRem - parseRemLength(screenPaddingX.desktop) * 2,
};

// Table column min width is 1/6 of the desktop block width. See `content.css.ts`.
const tableColumnMinWidthRem = contentBlockMaxWidthRem.desktop * (1 / 6);

// Table cell horizontal padding matches the quote block indentation (spacing "3").
const tableCellPaddingXRem = parseRemLength(spacing["3"]);

/**
 * The minimum size (width or height) for a file element in rem. Derived from the
 * smallest context a file may render in: a table column at minimum width minus
 * cell padding on both sides.
 */
export const contentFileMinSizeRem = tableColumnMinWidthRem - tableCellPaddingXRem * 2;

/**
 * The gap width between files in a file row, in rem. Matches spacing "2".
 */
export const contentFileRowGapWidthRem = parseRemLength(spacing["2"]);

/**
 * The maximum height for file rows, in rem. Matches spacing "128" (32rem).
 */
export const contentFileRowMaxHeightRem = parseRemLength(spacing["128"]);

/**
 * The fallback width in pixels for files whose preview fills the block (audio,
 * code, processing images). Uses the mobile block max width at the large spacing
 * scale so files scale down as needed on smaller screens.
 */
export const contentLargeFallbackFileWidthPx =
    contentBlockMaxWidthRem.mobile * remPxBySpacingScale.large;
