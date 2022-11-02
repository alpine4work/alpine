/*!
 * Our body font family is [Inter][1] and our code font family is
 * [Fira Code][2] (with ligatures disabled).
 *
 * [1]: https://rsms.me/inter
 * [2]: https://github.com/tonsky/FiraCode
 */

import {fontFace} from "@vanilla-extract/css";

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
 * The fonts available in our product.
 */
export const fonts = {
    primary: {
        fontFamily: interFontFamily,
        fontWeight: 400,
        fontStyle: "normal",
    },
    primaryMedium: {
        fontFamily: interFontFamily,
        fontWeight: 500,
        fontStyle: "normal",
    },
    primarySemiBold: {
        fontFamily: interFontFamily,
        fontWeight: 600,
        fontStyle: "normal",
    },
    primaryBold: {
        fontFamily: interFontFamily,
        fontWeight: 700,
        fontStyle: "normal",
    },
    code: {
        fontFamily: firaCodeFontFamily,
        fontWeight: 400,
        fontStyle: "normal",
    },
    codeBold: {
        fontFamily: firaCodeFontFamily,
        fontWeight: 700,
        fontStyle: "normal",
    },
};

/**
 * Line height is 1.5x for all sizes except `small`. For `small` the line
 * height is 1rem because `small` is our default font size for UI text (e.g.
 * button labels) and we want it to play nice with our spacing scale.
 *
 * It's more important that our line heights make our typography look good than
 * to match our spacing scale. If we want text to fit in our spacing scale, use
 * a container that fits it to the right size.
 */
export const bodyFontAndHeaderFontLineHeight = "1.5em" as const;

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
export const fontScale = {
    tiny: {
        fontSize: "0.625rem",
        lineHeight: bodyFontAndHeaderFontLineHeight,
        letterSpacing: "0.01em",
    },
    small: {
        fontSize: "0.75rem",
        lineHeight: "1rem",
        letterSpacing: "0em",
    },
    body: {
        fontSize: "1rem",
        lineHeight: bodyFontAndHeaderFontLineHeight,
        letterSpacing: "-0.011em",
    },
    heading5: {
        fontSize: "1.25rem",
        lineHeight: bodyFontAndHeaderFontLineHeight,
        letterSpacing: "-0.017em",
    },
    heading4: {
        fontSize: "1.75rem",
        lineHeight: bodyFontAndHeaderFontLineHeight,
        letterSpacing: "-0.021em",
    },
    heading3: {
        fontSize: "2.25rem",
        lineHeight: bodyFontAndHeaderFontLineHeight,
        letterSpacing: "-0.022em",
    },
    heading2: {
        fontSize: "3rem",
        lineHeight: bodyFontAndHeaderFontLineHeight,
        letterSpacing: "-0.022em",
    },
    heading1: {
        fontSize: "4.25rem",
        lineHeight: bodyFontAndHeaderFontLineHeight,
        letterSpacing: "-0.022em",
    },
    hero3: {
        fontSize: "5.625rem",
        lineHeight: bodyFontAndHeaderFontLineHeight,
        letterSpacing: "-0.022em",
    },
    hero2: {
        fontSize: "7.5rem",
        lineHeight: bodyFontAndHeaderFontLineHeight,
        letterSpacing: "-0.022em",
    },
    hero1: {
        fontSize: "10rem",
        lineHeight: bodyFontAndHeaderFontLineHeight,
        letterSpacing: "-0.022em",
    },
} as const;
