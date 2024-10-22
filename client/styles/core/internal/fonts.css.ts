/**
 * Our body font family is [Inter][1] and our code font family is
 * [Commit Mono][2] (with ligatures disabled).
 *
 * [1]: https://rsms.me/inter
 * [2]: https://commitmono.com
 */

import {assignVars, createGlobalTheme, fontFace, globalStyle} from "@vanilla-extract/css";
import {mobilePlatformSelector} from "~/client/styles/core/internal/platform.css.js";
import {
    commitMonoFontSizeAdjust,
    interFontAscender,
    interFontDescender,
    interFontUnitsPerEm,
} from "~/shared/design/core/font_metrics.js";
import {createFontStyles, fontSizesByPlatform} from "~/shared/design/core/fonts.js";
import {RemLength} from "~/shared/design/core/spacing.js";
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
    src: `url(/fonts/inter.v1.woff2) format('woff2 supports variations'), url(/fonts/inter.v1.woff2) format('woff2-variations'), url(/fonts/inter.v1.woff2) format('woff2')`,
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
        src: `url(/fonts/inter-italic.v1.woff2) format('woff2 supports variations'), url(/fonts/inter-italic.v1.woff2) format('woff2-variations'), url(/fonts/inter-italic.v1.woff2) format('woff2')`,
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
    src: `url(/fonts/commit-mono.v1.woff2) format('woff2 supports variations'), url(/fonts/commit-mono.v1.woff2) format('woff2-variations'), url(/fonts/commit-mono.v1.woff2) format('woff2')`,
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
export const fontStyles = createFontStyles({
    interFontFamily,
    commitMonoFontFamily,
});

const fontSizeVars = createGlobalTheme(":root", {
    font: mapObjectValues(fontSizesByPlatform, ({desktop, mobile}) => {
        assert(desktop.lineHeight === mobile.lineHeight);
        return {
            fontSize: `${desktop.fontSize}px`,
            letterSpacing: desktop.letterSpacing,
        };
    }),
});

globalStyle(mobilePlatformSelector, {
    vars: assignVars(fontSizeVars, {
        font: mapObjectValues(fontSizesByPlatform, ({desktop, mobile}) => {
            assert(desktop.lineHeight === mobile.lineHeight);
            return {
                fontSize: `${mobile.fontSize}px`,
                letterSpacing: mobile.letterSpacing,
            };
        }),
    }),
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
