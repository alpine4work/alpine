/**
 * Our body font family is [Inter][1] and our code font family is
 * [Commit Mono][2] (with ligatures disabled).
 *
 * [1]: https://rsms.me/inter
 * [2]: https://commitmono.com
 */

import {assignVars, createGlobalTheme, fontFace, globalStyle} from "@vanilla-extract/css";
import {
    commitMonoFontHash,
    interFontHash,
    interItalicFontHash,
} from "~/shared/design/font_hashes.js";
import {
    commitMonoFontSizeAdjust,
    interFontAscender,
    interFontDescender,
    interFontUnitsPerEm,
} from "~/shared/design/font_metrics.js";
import {RemLength, mobilePlatformMediaQuery} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

const formatPercentage = (percentage: number) =>
    `${Math.round(percentage * 100 * 10 ** 5) / 10 ** 5}%`;

/**
 * The percentage you multiply your `font-size` by to get the height rendered by
 * `background-color` in the browser.
 */
export const backgroundFontSizePercentage =
    (interFontAscender + interFontDescender) / interFontUnitsPerEm;

const interWithoutItalicFontFaceRule: Parameters<typeof fontFace>[0] & {src: string} = {
    // See how to use variable fonts:
    // https://css-tricks.com/newsletter/259-how-to-use-variable-fonts/
    src: `url(/fonts/inter-${interFontHash}.woff2) format('woff2 supports variations'), url(/fonts/inter-${interFontHash}.woff2) format('woff2-variations'), url(/fonts/inter-${interFontHash}.woff2) format('woff2')`,
    fontWeight: "100 900",
    fontStyle: "normal",
    fontDisplay: "swap",
    // Shouldn't be necessary but we include to ensure layout is stable when
    // swapping fonts.
    ascentOverride: formatPercentage(interFontAscender / interFontUnitsPerEm),
    descentOverride: formatPercentage(interFontDescender / interFontUnitsPerEm),
};

const interWithoutItalicFontFace = fontFace(interWithoutItalicFontFaceRule);

const interFontFace = fontFace([
    interWithoutItalicFontFaceRule,
    {
        // See how to use variable fonts:
        // https://css-tricks.com/newsletter/259-how-to-use-variable-fonts/
        src: `url(/fonts/inter-italic-${interItalicFontHash}.woff2) format('woff2 supports variations'), url(/fonts/inter-italic-${interItalicFontHash}.woff2) format('woff2-variations'), url(/fonts/inter-italic-${interItalicFontHash}.woff2) format('woff2')`,
        fontWeight: "100 900",
        fontStyle: "italic",
        fontDisplay: "swap",
        // Shouldn't be necessary but we include to ensure layout is stable when
        // swapping fonts.
        ascentOverride: formatPercentage(interFontAscender / interFontUnitsPerEm),
        descentOverride: formatPercentage(interFontDescender / interFontUnitsPerEm),
    },
]);

const commitMonoFontFace = fontFace({
    // See how to use variable fonts:
    // https://css-tricks.com/newsletter/259-how-to-use-variable-fonts/
    src: `url(/fonts/commit-mono-${commitMonoFontHash}.woff2) format('woff2 supports variations'), url(/fonts/commit-mono-${commitMonoFontHash}.woff2) format('woff2-variations'), url(/fonts/commit-mono-${commitMonoFontHash}.woff2) format('woff2')`,
    fontWeight: "100 900",
    fontDisplay: "swap",
    // Make sure the x-height of our monospace font matches the x-height of Inter.
    sizeAdjust: formatPercentage(commitMonoFontSizeAdjust),
    // Shouldn't be necessary since we modify the font to have matching
    // ascender/descender stats with Inter (since Safari doesn't support
    // `ascent-override` and `descent-override`) but we include to ensure layout is
    // stable when swapping fonts.
    ascentOverride: formatPercentage(
        interFontAscender / (interFontUnitsPerEm * commitMonoFontSizeAdjust),
    ),
    descentOverride: formatPercentage(
        interFontDescender / (interFontUnitsPerEm * commitMonoFontSizeAdjust),
    ),
});

const emojiFontFace = fontFace({
    // Emoji font stack is originally from: https://www.client9.com/css-color-emoji-stack/
    src: 'local("Apple Color Emoji"), local("Segoe UI Emoji"), local("NotoColorEmoji"), local("Noto Color Emoji"), local("Segoe UI Symbol"), local("Android Emoji"), local("EmojiSymbols")',
    // Use the same ascent/descent metrics for our emoji font face. This means
    // `background-color`s, font sizes, line heights, everything set on this font
    // will line up with our main font Inter.
    ascentOverride: formatPercentage(interFontAscender / interFontUnitsPerEm),
    descentOverride: formatPercentage(interFontDescender / interFontUnitsPerEm),
});

// Value taken from the fallback font `@next/font` generates for Inter.
// We use the same fallback font for Inter and Commit Mono because Commit Mono
// is resized to the same size as Inter.
//
// See:
// https://beta.nextjs.org/docs/optimizing/fonts
// https://github.com/vercel/next.js/blob/a6b40317294308f2d67240b789a8bbfcca694703/packages/font/src/google/loader.ts#L138-L148
const fallbackFontSizeAdjust = 1.0764;

const fallbackFontFace = fontFace({
    src: 'local("Arial")',
    ascentOverride: formatPercentage(
        interFontAscender / (interFontUnitsPerEm * fallbackFontSizeAdjust),
    ),
    descentOverride: formatPercentage(
        interFontDescender / (interFontUnitsPerEm * fallbackFontSizeAdjust),
    ),
    sizeAdjust: `${fallbackFontSizeAdjust * 100}%`,
});

// If our italic font hasn't loaded, fallback to an Inter font face without the
// italic file so we temporarily render Inter but the browser manually
// slants it.
const interFontFamily = `${interFontFace}, ${interWithoutItalicFontFace}, ${fallbackFontFace}`;

const commitMonoFontFamily = `${commitMonoFontFace}, ${fallbackFontFace}`;

export const emojiFontFamily = emojiFontFace;

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
        // You must manually enable `calt` to get contextual alternatives.
        fontFeatureSettings: '"calt" off',
        // Don't allow bold or italic synthesis. Bold/italic fonts must be
        // explicitly defined by the `@font-face` rule.
        //
        // Inter is a variable font with an axis for bold text. There's a separate
        // Inter file for italic text.
        //
        // Commit Mono is a variable font with an axis for bold text and italic text.
        // `font-style: italic` won't work with Commit Mono and you need to set
        // `fontFeatureSettings: '"ital" 1'` with Commit Mono's other features.
        fontSynthesis: "none",
    },
    // Usually `font-weight: 500` maps to the name "Medium" but since we want to
    // make it clear the style is bold we name it "Semi Bold" so bold is in the
    // name.
    "semi-bold": {
        fontFamily: interFontFamily,
        fontWeight: 500,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
        fontSynthesis: "none",
    },
    // Usually `font-weight: 600` maps to the name "Semi Bold" but since it is the
    // most common heavy weight in our product we call it simply "Bold".
    bold: {
        fontFamily: interFontFamily,
        fontWeight: 600,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
        fontSynthesis: "none",
    },
    // Usually `font-weight: 700` maps to the name "Bold" but since it is less
    // common in our product than `font-weight: 600` we call it "Extra Bold".
    "extra-bold": {
        fontFamily: interFontFamily,
        fontWeight: 700,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
        fontSynthesis: "none",
    },
    // `extra-bold` and `ultra-bold` usually refer to the same thing but since
    // our bold weight starts at 600 we use `ultra-bold` as an intermediate value
    // to catch up.
    "ultra-bold": {
        fontFamily: interFontFamily,
        fontWeight: 800,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
        fontSynthesis: "none",
    },
    black: {
        fontFamily: interFontFamily,
        fontWeight: 900,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
        fontSynthesis: "none",
    },
    code: {
        fontFamily: commitMonoFontFamily,
        fontWeight: 375,
        fontStyle: "normal",
        fontFeatureSettings: '"cv02" on, "ss03" on, "ss04" on, "ss05" on',
        fontSynthesis: "none",
        // Reduce letter spacing on monospace font. Commit Mono is wider than Inter
        // because each letter (even “i” and “l”) have the same width. Reduced letter
        // spacing helps even things out.
        //
        // The custom `letter-spacing` does conflict with letter spacing from font
        // sizes! We need to be careful when applying both code and font size to let
        // the letter spacing from our font win.
        letterSpacing: "-0.02em",
    },
    "code-semi-bold": {
        fontFamily: commitMonoFontFamily,
        fontWeight: 500,
        fontStyle: "normal",
        fontFeatureSettings: '"cv02" on, "ss03" on, "ss04" on, "ss05" on',
        fontSynthesis: "none",
        letterSpacing: "-0.02em",
    },
    "code-bold": {
        fontFamily: commitMonoFontFamily,
        fontWeight: 600,
        fontStyle: "normal",
        fontFeatureSettings: '"cv02" on, "ss03" on, "ss04" on, "ss05" on',
        fontSynthesis: "none",
        letterSpacing: "-0.02em",
    },
    "code-extra-bold": {
        fontFamily: commitMonoFontFamily,
        fontWeight: 700,
        fontStyle: "normal",
        fontFeatureSettings: '"cv02" on, "ss03" on, "ss04" on, "ss05" on',
        fontSynthesis: "none",
        letterSpacing: "-0.02em",
    },
    // Styles that truncates text to a single line and shows ellipsis for
    // truncated characters.
    truncate: {
        fontFamily: interFontFamily,
        fontWeight: 400,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
        fontSynthesis: "none",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    "truncate-semi-bold": {
        fontFamily: interFontFamily,
        fontWeight: 500,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
        fontSynthesis: "none",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    "truncate-bold": {
        fontFamily: interFontFamily,
        fontWeight: 600,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
        fontSynthesis: "none",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
    "truncate-code": {
        fontFamily: commitMonoFontFamily,
        fontWeight: 350,
        fontStyle: "normal",
        fontFeatureSettings: '"cv02" on, "ss03" on, "ss04" on, "ss05" on',
        fontSynthesis: "none",
        letterSpacing: "-0.02em",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
    },
} as const;

/**
 * Font scale computed with the following:
 * https://www.desmos.com/calculator/rewoqdxtac
 */
export const fontSizesByPlatform = {
    "25": {
        desktop: {
            fontSize: 10,
            letterSpacing: "0.01em",
            lineHeight: "0.75rem",
        },
        mobile: {
            fontSize: 13,
            letterSpacing: "-0.0032em",
            lineHeight: "0.75rem",
        },
    },
    "50": {
        desktop: {
            fontSize: 11,
            letterSpacing: "0.0048em",
            lineHeight: "0.875rem",
        },
        mobile: {
            fontSize: 14,
            letterSpacing: "-0.0062em",
            lineHeight: "0.875rem",
        },
    },
    "75": {
        desktop: {
            fontSize: 12,
            letterSpacing: "0.0005em",
            lineHeight: "1rem",
        },
        mobile: {
            fontSize: 15,
            letterSpacing: "-0.0088em",
            lineHeight: "1rem",
        },
    },
    "100-extra-compact": {
        desktop: {
            fontSize: 13,
            letterSpacing: "-0.0032em",
            lineHeight: "1.25rem",
        },
        mobile: {
            fontSize: 16,
            letterSpacing: "-0.011em",
            lineHeight: "1.25rem",
        },
    },
    "100": {
        desktop: {
            fontSize: 14,
            letterSpacing: "-0.0062em",
            lineHeight: "1.25rem",
        },
        mobile: {
            // 17px is the default size for text on iOS according to the [Human Interface
            // Guidelines][1].
            //
            // [1]: https://developer.apple.com/design/human-interface-guidelines/typography#Specifications
            fontSize: 17,
            letterSpacing: "-0.0128em",
            lineHeight: "1.25rem",
        },
    },
    "200": {
        desktop: {
            fontSize: 16,
            letterSpacing: "-0.011em",
            lineHeight: "1.5rem",
        },
        mobile: {
            fontSize: 20,
            letterSpacing: "-0.0167em",
            lineHeight: "1.5rem",
        },
    },
    "300": {
        desktop: {
            fontSize: 18,
            letterSpacing: "-0.0143em",
            lineHeight: "1.625rem",
        },
        mobile: {
            fontSize: 22,
            letterSpacing: "-0.0183em",
            lineHeight: "1.625rem",
        },
    },
    // Font size in between 300 and 400 used for our heading scale on mobile.
    // Should only be used for mobile headings, not considered a part of our
    // general typography scale.
    "mobile-heading-350": {
        desktop: {
            fontSize: 19,
            letterSpacing: "-0.0156em",
            lineHeight: "1.625rem",
        },
        mobile: {
            fontSize: 23,
            letterSpacing: "-0.019em",
            lineHeight: "1.625rem",
        },
    },
    "400": {
        desktop: {
            fontSize: 20,
            letterSpacing: "-0.0167em",
            lineHeight: "1.75rem",
        },
        mobile: {
            fontSize: 25,
            letterSpacing: "-0.0199em",
            lineHeight: "1.75rem",
        },
    },
    "500": {
        desktop: {
            fontSize: 22,
            letterSpacing: "-0.0183em",
            lineHeight: "1.875rem",
        },
        mobile: {
            fontSize: 28,
            letterSpacing: "-0.0209em",
            lineHeight: "1.875rem",
        },
    },
    "600": {
        desktop: {
            fontSize: 25,
            letterSpacing: "-0.0199em",
            lineHeight: "2.125rem",
        },
        mobile: {
            fontSize: 31,
            letterSpacing: "-0.0215em",
            lineHeight: "2.125rem",
        },
    },
    "700": {
        desktop: {
            fontSize: 28,
            letterSpacing: "-0.0209em",
            lineHeight: "2.25rem",
        },
        mobile: {
            fontSize: 35,
            letterSpacing: "-0.0219em",
            lineHeight: "2.25rem",
        },
    },
    "800": {
        desktop: {
            fontSize: 32,
            letterSpacing: "-0.0216em",
            lineHeight: "2.5rem",
        },
        mobile: {
            fontSize: 40,
            letterSpacing: "-0.0221em",
            lineHeight: "2.5rem",
        },
    },
    "900": {
        desktop: {
            fontSize: 36,
            letterSpacing: "-0.022em",
            lineHeight: "2.75rem",
        },
        mobile: {
            fontSize: 45,
            letterSpacing: "-0.0222em",
            lineHeight: "2.75rem",
        },
    },
    "1000": {
        desktop: {
            fontSize: 40,
            letterSpacing: "-0.0221em",
            lineHeight: "3rem",
        },
        mobile: {
            fontSize: 50,
            letterSpacing: "-0.0223em",
            lineHeight: "3rem",
        },
    },
    "1100": {
        desktop: {
            fontSize: 45,
            letterSpacing: "-0.0222em",
            lineHeight: "3.375rem",
        },
        mobile: {
            fontSize: 56,
            letterSpacing: "-0.0223em",
            lineHeight: "3.375rem",
        },
    },
    "1200": {
        desktop: {
            fontSize: 50,
            letterSpacing: "-0.0223em",
            lineHeight: "3.75rem",
        },
        mobile: {
            fontSize: 62,
            letterSpacing: "-0.0223em",
            lineHeight: "3.75rem",
        },
    },
    "1300": {
        desktop: {
            fontSize: 60,
            letterSpacing: "-0.0223em",
            lineHeight: "4.5rem",
        },
        mobile: {
            fontSize: 75,
            letterSpacing: "-0.0223em",
            lineHeight: "4.5rem",
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

export type FontSize = keyof typeof fontSizesByPlatform;

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
export const fontSizes: {
    [K in keyof typeof fontSizesByPlatform]: {
        fontSize: string;
        letterSpacing: string;
        lineHeight: RemLength;
    };
} = mapObjectValues(fontSizesByPlatform, ({desktop, mobile}, fontSizeName) => {
    assert(desktop.lineHeight === mobile.lineHeight);
    return {
        fontSize: fontSizeVars.font[fontSizeName].fontSize,
        letterSpacing: fontSizeVars.font[fontSizeName].letterSpacing,
        lineHeight: desktop.lineHeight,
    };
});
