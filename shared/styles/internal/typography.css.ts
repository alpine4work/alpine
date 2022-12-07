/**
 * Our body font family is [Inter][1] and our code font family is
 * [Fira Code][2] (with ligatures disabled).
 *
 * [1]: https://rsms.me/inter
 * [2]: https://github.com/tonsky/FiraCode
 */

import {fontFace, style} from "@vanilla-extract/css";
import {spacing} from "~/shared/design/spacing";

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
 */
export const typographyStyle = {
    primary: {
        fontFamily: interFontFamily,
        fontWeight: 400,
        fontStyle: "normal",
        fontFeatureSettings: "normal",
    },
    primaryMedium: {
        fontFamily: interFontFamily,
        fontWeight: 500,
        fontStyle: "normal",
        fontFeatureSettings: "normal",
    },
    primarySemiBold: {
        fontFamily: interFontFamily,
        fontWeight: 600,
        fontStyle: "normal",
        fontFeatureSettings: "normal",
    },
    primaryBold: {
        fontFamily: interFontFamily,
        fontWeight: 700,
        fontStyle: "normal",
        fontFeatureSettings: "normal",
    },
    code: {
        fontFamily: firaCodeFontFamily,
        fontWeight: 400,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
    },
    codeBold: {
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
export const typographySize = {
    tiny: {
        fontSize: "0.625rem",
        // TODO(calebmer): Haven't really tested for what line height looks good here.
        // Picking a value on the spacing scale.
        lineHeight: spacing["3"],
        letterSpacing: "0.01em",
    },
    small: {
        fontSize: "0.75rem",
        // This line-height is optimized for alignment with spacing scale vs what
        // optically looks good in long blocks of text. Since `small` is the default
        // size for UI text.
        lineHeight: spacing["4"],
        letterSpacing: "0em",
    },
    body: {
        fontSize: "1rem",
        // Same as a 1.5em line-height. Conveniently also looks good!
        lineHeight: spacing["6"],
        letterSpacing: "-0.011em",
    },
    heading5: {
        fontSize: "1.25rem",
        lineHeight: `${1.4 * 1.25}rem`,
        letterSpacing: "-0.017em",
    },
    heading4: {
        fontSize: "1.75rem",
        lineHeight: `${1.3 * 1.75}rem`,
        letterSpacing: "-0.021em",
    },
    heading3: {
        fontSize: "2.25rem",
        lineHeight: `${1.25 * 2.25}rem`,
        letterSpacing: "-0.022em",
    },
    heading2: {
        fontSize: "3rem",
        lineHeight: `${1.2 * 3}rem`,
        letterSpacing: "-0.022em",
    },
    heading1: {
        fontSize: "4.25rem",
        lineHeight: `${1.2 * 4.25}rem`,
        letterSpacing: "-0.022em",
    },
    hero3: {
        fontSize: "5.625rem",
        lineHeight: `${1.2 * 5.625}rem`,
        letterSpacing: "-0.022em",
    },
    hero2: {
        fontSize: "7.5rem",
        lineHeight: `${1.2 * 7.5}rem`,
        letterSpacing: "-0.022em",
    },
    hero1: {
        fontSize: "10rem",
        lineHeight: `${1.2 * 10}rem`,
        letterSpacing: "-0.022em",
    },
} as const;

export const truncateClassName = style({
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
});
