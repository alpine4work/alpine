/**
 * Our body font family is [Inter][1] and our code font family is
 * [Commit Mono][2] (with ligatures disabled).
 *
 * [1]: https://rsms.me/inter
 * [2]: https://commitmono.com
 */

import {assignVars, createGlobalTheme, globalStyle} from "@vanilla-extract/css";
import {
    largeSpacingScaleSelector,
    mediumSpacingScaleSelector,
} from "~/client/styles/core/internal/selectors.css.js";
import {
    interFontAscender,
    interFontDescender,
    interFontUnitsPerEm,
} from "~/shared/design/core/font_metrics.js";
import {createFontStyles, fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {RemLength} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

/**
 * The percentage you multiply your `font-size` by to get the height rendered by
 * `background-color` in the browser.
 */
export const backgroundFontSizePercentage =
    (interFontAscender + interFontDescender) / interFontUnitsPerEm;

// Definitions for these fonts are in `fonts_critical_css.ts`.
//
// If our italic font hasn't loaded, fallback to an Inter font face without the
// italic file so we temporarily render Inter but the browser manually
// slants it.
export const interFontFamily = "CyInter, CyInterWithoutItalic, CyInterFallback";

const commitMonoFontFamily = "CyCommitMono, CyInterFallback";

export const emojiFontFamily = "CyEmoji";

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
    font: mapObjectValues(fontSizesBySpacingScale, ({small, large}) => {
        assert(small.lineHeight === large.lineHeight);
        return {
            fontSize: `${small.fontSize}px`,
            letterSpacing: small.letterSpacing,
        };
    }),
});

globalStyle(mediumSpacingScaleSelector, {
    vars: assignVars(fontSizeVars, {
        font: mapObjectValues(fontSizesBySpacingScale, ({small, medium}) => {
            assert(small.lineHeight === medium.lineHeight);
            return {
                fontSize: `${medium.fontSize}px`,
                letterSpacing: medium.letterSpacing,
            };
        }),
    }),
});

globalStyle(largeSpacingScaleSelector, {
    vars: assignVars(fontSizeVars, {
        font: mapObjectValues(fontSizesBySpacingScale, ({small, large}) => {
            assert(small.lineHeight === large.lineHeight);
            return {
                fontSize: `${large.fontSize}px`,
                letterSpacing: large.letterSpacing,
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
    [K in keyof typeof fontSizesBySpacingScale]: {
        fontSize: string;
        letterSpacing: string;
        lineHeight: RemLength;
    };
} = mapObjectValues(fontSizesBySpacingScale, ({small, medium, large}, fontSizeName) => {
    assert(small.lineHeight === medium.lineHeight);
    assert(small.lineHeight === large.lineHeight);
    return {
        fontSize: fontSizeVars.font[fontSizeName].fontSize,
        letterSpacing: fontSizeVars.font[fontSizeName].letterSpacing,
        lineHeight: small.lineHeight,
    };
});
