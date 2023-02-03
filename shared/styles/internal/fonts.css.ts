/**
 * Our body font family is [Inter][1] and our code font family is
 * [Fira Code][2] (with ligatures disabled).
 *
 * [1]: https://rsms.me/inter
 * [2]: https://github.com/tonsky/FiraCode
 */

import {assignVars, createGlobalTheme, fontFace, globalStyle} from "@vanilla-extract/css";
import {mobilePlatformMediaQuery} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values";

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
    // Styles that truncates text to a single line and shows ellipsis for
    // truncated characters.
    truncate: {
        fontFamily: interFontFamily,
        fontWeight: 400,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    "truncate-semi-bold": {
        fontFamily: interFontFamily,
        fontWeight: 500,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    "truncate-bold": {
        fontFamily: interFontFamily,
        fontWeight: 600,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
} as const;

export const fontSizesByPlatform = {
    "50": {
        desktop: {
            fontSize: 11,
            letterSpacing: "0.005em",
            lineHeight: "0.875rem",
        },
        mobile: {
            fontSize: 13,
            letterSpacing: "-0.0025em",
            lineHeight: "0.875rem",
        },
    },
    "75": {
        desktop: {
            fontSize: 12,
            letterSpacing: "0em",
            lineHeight: "1rem",
        },
        mobile: {
            fontSize: 15,
            letterSpacing: "-0.009em",
            lineHeight: "1rem",
        },
    },
    "100": {
        desktop: {
            fontSize: 14,
            letterSpacing: "-0.006em",
            lineHeight: "1.125rem",
        },
        mobile: {
            fontSize: 17,
            letterSpacing: "-0.013em",
            lineHeight: "1.125rem",
        },
    },
    "200": {
        desktop: {
            fontSize: 16,
            letterSpacing: "-0.011em",
            lineHeight: "1.25rem",
        },
        mobile: {
            fontSize: 19,
            letterSpacing: "-0.016em",
            lineHeight: "1.25rem",
        },
    },
    "300": {
        desktop: {
            fontSize: 18,
            letterSpacing: "-0.014em",
            lineHeight: "1.5rem",
        },
        mobile: {
            fontSize: 22,
            letterSpacing: "-0.018em",
            lineHeight: "1.5rem",
        },
    },
    "400": {
        desktop: {
            fontSize: 20,
            letterSpacing: "-0.017em",
            lineHeight: "1.625rem",
        },
        mobile: {
            fontSize: 24,
            letterSpacing: "-0.019em",
            lineHeight: "1.625rem",
        },
    },
    "500": {
        desktop: {
            fontSize: 22,
            letterSpacing: "-0.018em",
            lineHeight: "1.75rem",
        },
        mobile: {
            fontSize: 27,
            letterSpacing: "-0.021em",
            lineHeight: "1.75rem",
        },
    },
    "600": {
        desktop: {
            fontSize: 25,
            letterSpacing: "-0.02em",
            lineHeight: "2rem",
        },
        mobile: {
            fontSize: 31,
            letterSpacing: "-0.021em",
            lineHeight: "2rem",
        },
    },
    "700": {
        desktop: {
            fontSize: 28,
            letterSpacing: "-0.021em",
            lineHeight: "2.25rem",
        },
        mobile: {
            fontSize: 34,
            letterSpacing: "-0.022em",
            lineHeight: "2.25rem",
        },
    },
    "800": {
        desktop: {
            fontSize: 32,
            letterSpacing: "-0.022em",
            lineHeight: "2.625rem",
        },
        mobile: {
            fontSize: 39,
            letterSpacing: "-0.022em",
            lineHeight: "2.625rem",
        },
    },
    "900": {
        desktop: {
            fontSize: 36,
            letterSpacing: "-0.022em",
            lineHeight: "2.875rem",
        },
        mobile: {
            fontSize: 44,
            letterSpacing: "-0.022em",
            lineHeight: "2.875rem",
        },
    },
    "1000": {
        desktop: {
            fontSize: 40,
            letterSpacing: "-0.022em",
            lineHeight: "3.25rem",
        },
        mobile: {
            fontSize: 49,
            letterSpacing: "-0.022em",
            lineHeight: "3.25rem",
        },
    },
    "1100": {
        desktop: {
            fontSize: 45,
            letterSpacing: "-0.022em",
            lineHeight: "3.625rem",
        },
        mobile: {
            fontSize: 55,
            letterSpacing: "-0.022em",
            lineHeight: "3.625rem",
        },
    },
    "1200": {
        desktop: {
            fontSize: 50,
            letterSpacing: "-0.022em",
            lineHeight: "4.125rem",
        },
        mobile: {
            fontSize: 62,
            letterSpacing: "-0.022em",
            lineHeight: "4.125rem",
        },
    },
    "1300": {
        desktop: {
            fontSize: 60,
            letterSpacing: "-0.022em",
            lineHeight: "4.875rem",
        },
        mobile: {
            fontSize: 70,
            letterSpacing: "-0.022em",
            lineHeight: "4.875rem",
        },
    },
} as const;

const fontSizeVars = createGlobalTheme(":root", {
    font: mapObjectValues(fontSizesByPlatform, ({desktop, mobile}) => {
        assert(desktop.lineHeight === mobile.lineHeight);
        return {
            fontSize: `${desktop.fontSize}px`,
            letterSpacing: desktop.letterSpacing,
        };
    }),
});

globalStyle(":root", {
    "@media": {
        [mobilePlatformMediaQuery]: {
            vars: assignVars(fontSizeVars, {
                font: mapObjectValues(fontSizesByPlatform, ({desktop, mobile}) => {
                    assert(desktop.lineHeight === mobile.lineHeight);
                    return {
                        fontSize: `${mobile.fontSize}px`,
                        letterSpacing: mobile.letterSpacing,
                    };
                }),
            }),
        },
    },
});

/**
 * The font scale for our product. A couple details on how this is constructed:
 *
 * - The mobile font size is 1.25x the desktop font size rounded.
 * - Mobile font sizes are carefully aligned with the [Apple HIG][1] font sizes
 *   to make sure typography feels correct on mobile.
 * - Letter spacing is computed with [Inter's dynamic metric][2] tracking
 *   formula.
 * - Line heights must be the same REM value on desktop and mobile so that our
 *   layouts don't shift.
 * - Line heights are ~1.3x the font size. This is the default line height for
 *   UI components and headings. Body text should have a line height of 1.5x
 *   the font size.
 *
 * We've taken inspiration from [Adobe Spectrum][3], [Apple HIG][1], and
 * [Untitled UI][4] for this font scale.
 *
 * [1]: https://developer.apple.com/design/human-interface-guidelines/foundations/typography
 * [2]: https://rsms.me/inter/dynmetrics
 * [3]: https://spectrum.adobe.com/page/typography
 * [4]: https://www.untitledui.com
 */
export const fontSizes = mapObjectValues(fontSizesByPlatform, ({desktop, mobile}, fontSizeName) => {
    assert(desktop.lineHeight === mobile.lineHeight);
    return {
        fontSize: fontSizeVars.font[fontSizeName].fontSize,
        letterSpacing: fontSizeVars.font[fontSizeName].letterSpacing,
        lineHeight: desktop.lineHeight,
    };
});
