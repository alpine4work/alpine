/* eslint-disable string-quotes */

import {
    commitMonoFontSizeAdjust,
    interFontAscender,
    interFontDescender,
    interFontUnitsPerEm,
} from "~/shared/design/core/font_metrics.js";

const formatPercentage = (percentage: number) =>
    `${Math.round(percentage * 100 * 10 ** 5) / 10 ** 5}%`;

// Value taken from the fallback font `@next/font` generates for Inter.
// We use the same fallback font for Inter and Commit Mono because Commit Mono
// is resized to the same size as Inter.
//
// See:
// https://beta.nextjs.org/docs/optimizing/fonts
// https://github.com/vercel/next.js/blob/a6b40317294308f2d67240b789a8bbfcca694703/packages/font/src/google/loader.ts#L138-L148
const fallbackFontSizeAdjust = 1.0764;

/**
 * We inline this CSS in a `<style>` element so the browser doesn't have to
 * fetch our `styles.css` file to know what our font URLs are. Also it means
 * in development when hot reloading our styles we don't reset our
 * `@font-face`s.
 */
export const getFontsCriticalCss = (resourceServiceUrl: string) =>
    "@font-face { " +
    'font-family: "CyInterWithoutItalic"; ' +
    // See how to use variable fonts:
    // https://css-tricks.com/newsletter/259-how-to-use-variable-fonts/
    `src: url(${resourceServiceUrl}/fonts/inter.v1.woff2) format('woff2 supports variations'), url(${resourceServiceUrl}/fonts/inter.v1.woff2) format('woff2-variations'), url(${resourceServiceUrl}/fonts/inter.v1.woff2) format('woff2'); ` +
    "font-weight: 100 900; " +
    "font-style: normal; " +
    "font-display: swap; " +
    // Shouldn't be necessary but we include to ensure layout is stable when
    // swapping fonts.
    `ascent-override: ${formatPercentage(interFontAscender / interFontUnitsPerEm)}; ` +
    `descent-override: ${formatPercentage(interFontDescender / interFontUnitsPerEm)}; ` +
    "} " +
    /* ===================================================================== */
    "@font-face { " +
    'font-family: "CyInter"; ' +
    // See how to use variable fonts:
    // https://css-tricks.com/newsletter/259-how-to-use-variable-fonts/
    `src: url(${resourceServiceUrl}/fonts/inter.v1.woff2) format('woff2 supports variations'), url(${resourceServiceUrl}/fonts/inter.v1.woff2) format('woff2-variations'), url(${resourceServiceUrl}/fonts/inter.v1.woff2) format('woff2'); ` +
    "font-weight: 100 900; " +
    "font-style: normal; " +
    "font-display: swap; " +
    // Shouldn't be necessary but we include to ensure layout is stable when
    // swapping fonts.
    `ascent-override: ${formatPercentage(interFontAscender / interFontUnitsPerEm)}; ` +
    `descent-override: ${formatPercentage(interFontDescender / interFontUnitsPerEm)}; ` +
    "} " +
    /* ===================================================================== */
    "@font-face { " +
    'font-family: "CyInter"; ' +
    // See how to use variable fonts:
    // https://css-tricks.com/newsletter/259-how-to-use-variable-fonts/
    `src: url(${resourceServiceUrl}/fonts/inter-italic.v1.woff2) format('woff2 supports variations'), url(${resourceServiceUrl}/fonts/inter-italic.v1.woff2) format('woff2-variations'), url(${resourceServiceUrl}/fonts/inter-italic.v1.woff2) format('woff2'); ` +
    "font-weight: 100 900; " +
    "font-style: italic; " +
    "font-display: swap; " +
    // Shouldn't be necessary but we include to ensure layout is stable when
    // swapping fonts.
    `ascent-override: ${formatPercentage(interFontAscender / interFontUnitsPerEm)}; ` +
    `descent-override: ${formatPercentage(interFontDescender / interFontUnitsPerEm)}; ` +
    "} " +
    /* ===================================================================== */
    "@font-face { " +
    'font-family: "CyCommitMono"; ' +
    // See how to use variable fonts:
    // https://css-tricks.com/newsletter/259-how-to-use-variable-fonts/
    `src: url(${resourceServiceUrl}/fonts/commit-mono.v1.woff2) format('woff2 supports variations'), url(${resourceServiceUrl}/fonts/commit-mono.v1.woff2) format('woff2-variations'), url(${resourceServiceUrl}/fonts/commit-mono.v1.woff2) format('woff2'); ` +
    "font-weight: 100 900; " +
    "font-style: normal; " +
    "font-display: swap; " +
    // Make sure the x-height of our monospace font matches the x-height of Inter.
    `size-adjust: ${formatPercentage(commitMonoFontSizeAdjust)}; ` +
    // Shouldn't be necessary since we modify the font to have matching
    // ascender/descender stats with Inter (since Safari doesn't support
    // `ascent-override` and `descent-override`) but we include to ensure layout is
    // stable when swapping fonts.
    `ascent-override: ${formatPercentage(
        interFontAscender / (interFontUnitsPerEm * commitMonoFontSizeAdjust),
    )}; ` +
    `descent-override: ${formatPercentage(
        interFontDescender / (interFontUnitsPerEm * commitMonoFontSizeAdjust),
    )}; ` +
    "} " +
    /* ===================================================================== */
    "@font-face { " +
    'font-family: "CyEmoji"; ' +
    // Emoji font stack is originally from: https://www.client9.com/css-color-emoji-stack/
    'src: local("Apple Color Emoji"), local("Segoe UI Emoji"), local("NotoColorEmoji"), local("Noto Color Emoji"), local("Segoe UI Symbol"), local("Android Emoji"), local("EmojiSymbols"); ' +
    // Use the same ascent/descent metrics for our emoji font face. This means
    // `background-color`s, font sizes, line heights, everything set on this font
    // will line up with our main font Inter.
    `ascent-override: ${formatPercentage(interFontAscender / interFontUnitsPerEm)}; ` +
    `descent-override: ${formatPercentage(interFontDescender / interFontUnitsPerEm)}; ` +
    "} " +
    /* ===================================================================== */
    "@font-face { " +
    'font-family: "CyInterFallback"; ' +
    `ascent-override: ${formatPercentage(
        interFontAscender / (interFontUnitsPerEm * fallbackFontSizeAdjust),
    )}; ` +
    `descent-override: ${formatPercentage(
        interFontDescender / (interFontUnitsPerEm * fallbackFontSizeAdjust),
    )}; ` +
    `size-adjust: ${fallbackFontSizeAdjust * 100}%; ` +
    "}";
