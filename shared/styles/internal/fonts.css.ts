/**
 * Our body font family is [Inter][1] and our code font family is
 * [Fira Code][2] (with ligatures disabled).
 *
 * [1]: https://rsms.me/inter
 * [2]: https://github.com/tonsky/FiraCode
 */

import {fontFace, style} from "@vanilla-extract/css";

// TODO(calebmer): Now that I've bought Untitled UI, give their premium font
// recommendations a look to see if we can do better than Inter.
const interFontFace = fontFace({
    src: "url(/fonts/inter.woff2) format('woff2')",
    fontStyle: "normal",
    fontWeight: "100 900",
});

const interFallbackFontFace = fontFace({
    src: 'local("Arial")',
    // Values taken from the fallback font `@next/font` generates. See:
    // https://beta.nextjs.org/docs/optimizing/fonts
    // https://github.com/vercel/next.js/blob/a6b40317294308f2d67240b789a8bbfcca694703/packages/font/src/google/loader.ts#L138-L148
    ascentOverride: "90.00%",
    descentOverride: "22.43%",
    lineGapOverride: "0.00%",
    sizeAdjust: "107.64%",
});

const firaCodeFontFace = fontFace({
    src: "url(/fonts/fira-code.woff2) format('woff2')",
    fontStyle: "normal",
    fontWeight: "300 700",
});

const firaCodeFallbackFontFace = fontFace({
    src: 'local("Arial")',
    // Values taken from the fallback font `@next/font` generates. See:
    // https://beta.nextjs.org/docs/optimizing/fonts
    // https://github.com/vercel/next.js/blob/a6b40317294308f2d67240b789a8bbfcca694703/packages/font/src/google/loader.ts#L138-L148
    ascentOverride: "75.29%",
    descentOverride: "24.49%",
    lineGapOverride: "0.00%",
    sizeAdjust: "131.49%",
});

const interFontFamily = `${interFontFace}, ${interFallbackFontFace}`;
const firaCodeFontFamily = `${firaCodeFontFace}, ${firaCodeFallbackFontFace}`;

/**
 * The typography styles available in our product.
 *
 * We only allow certain combinations of font families and weights
 * for performance.
 *
 * Though for variable fonts we may provide more style variants since
 * they're free to add.
 */
export const fontStyles = {
    normal: {
        fontFamily: interFontFamily,
        fontWeight: 400,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
    },
    // Usually `font-weight: 500` maps to the name "Medium" but since we want to
    // make it clear the style is bold we name it "Semi Bold" so bold is in the
    // name.
    "semi-bold": {
        fontFamily: interFontFamily,
        fontWeight: 500,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
    },
    // Usually `font-weight: 600` maps to the name "Semi Bold" but since it is the
    // most common heavy weight in our product we call it simply "Bold".
    bold: {
        fontFamily: interFontFamily,
        fontWeight: 600,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
    },
    // Usually `font-weight: 700` maps to the name "Bold" but since it is less
    // common in our product than `font-weight: 600` we call it "Extra Bold".
    "extra-bold": {
        fontFamily: interFontFamily,
        fontWeight: 700,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
    },
    code: {
        fontFamily: firaCodeFontFamily,
        fontWeight: 400,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
    },
    "code-bold": {
        fontFamily: firaCodeFontFamily,
        fontWeight: 700,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
    },
};

/**
 * The font scale for our product.
 *
 * To determine letter spacing we use Inter's [dynamic metrics][1] for the font
 * size on desktop machines. We should consider:
 *
 * - Whether we should use different letter spacing at mobile scale.
 * - Whether other fonts should have different letter spacing.
 *
 * [1]: https://rsms.me/inter/dynmetrics
 */
export const fontSizes = {
    "2xs": {
        fontSize: "0.625rem",
        lineHeight: "1rem",
        letterSpacing: "0.01em",
    },
    xs: {
        fontSize: "0.75rem",
        lineHeight: "1.125rem",
        letterSpacing: "0em",
    },
    sm: {
        fontSize: "0.875rem",
        lineHeight: "1.25rem",
        letterSpacing: "-0.006em",
    },
    md: {
        fontSize: "1rem",
        lineHeight: "1.5rem",
        letterSpacing: "-0.011em",
    },
    lg: {
        fontSize: "1.125rem",
        lineHeight: "1.75rem",
        letterSpacing: "-0.014em",
    },
    xl: {
        fontSize: "1.25rem",
        lineHeight: "1.875rem",
        letterSpacing: "-0.017em",
    },
    "display-xs": {
        fontSize: "1.5rem",
        lineHeight: "2rem",
        letterSpacing: "-0.019em",
    },
    "display-sm": {
        fontSize: "1.875rem",
        lineHeight: "2.375rem",
        letterSpacing: "-0.021em",
    },
    "display-md": {
        fontSize: "2.25rem",
        lineHeight: "2.75rem",
        letterSpacing: "-0.022em",
    },
    "display-lg": {
        fontSize: "3rem",
        lineHeight: "3.75rem",
        letterSpacing: "-0.022em",
    },
    "display-xl": {
        fontSize: "3.75rem",
        lineHeight: "4.5rem",
        letterSpacing: "-0.022em",
    },
    "display-2xl": {
        fontSize: "4.5rem",
        lineHeight: "5.625rem",
        letterSpacing: "-0.022em",
    },
} as const;

/**
 * Class that truncates text to a single line and shows ellipsis for
 * truncated characters.
 */
export const truncateClassName = style({
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
});
