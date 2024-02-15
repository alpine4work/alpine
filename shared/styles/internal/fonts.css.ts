/**
 * Our body font family is [Inter][1] and our code font family is
 * [Fira Code][2] (with ligatures disabled).
 *
 * [1]: https://rsms.me/inter
 * [2]: https://github.com/tonsky/FiraCode
 */

import {assignVars, createGlobalTheme, fontFace, globalStyle} from "@vanilla-extract/css";
import {RemLength, mobilePlatformMediaQuery} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

// Font metrics taken from:
// https://opentype.js.org/font-inspector.html
const interFontAscender = 2728;
const interFontDescender = 680;
const interFontAscenderPercentage = interFontAscender / (interFontAscender + interFontDescender);
const interFontDescenderPercentage = interFontDescender / (interFontAscender + interFontDescender);

const formatPercentage = (percentage: number) => `${Math.round(percentage * 100 * 1000) / 1000}%`;

/**
 * The percentage you multiply your `font-size` by to get the height rendered by
 * `background-color` in the browser.
 */
export const backgroundFontSizePercentage =
    interFontAscenderPercentage + interFontDescenderPercentage + interFontDescenderPercentage;

const interFontFace = fontFace({
    // See how to use variable fonts:
    // https://css-tricks.com/newsletter/259-how-to-use-variable-fonts/
    src: "url(/fonts/inter.woff2) format('woff2')",
    fontWeight: "100 900",
    // It appears browsers add an extra descent to the font's ascent metric.
    // Presumably so that `background-color` appears centered around the text.
    ascentOverride: formatPercentage(interFontAscenderPercentage + interFontDescenderPercentage),
    descentOverride: formatPercentage(interFontDescenderPercentage),
});

const firaCodeFontFace = fontFace({
    // See how to use variable fonts:
    // https://css-tricks.com/newsletter/259-how-to-use-variable-fonts/
    src: "url(/fonts/fira-code.woff2) format('woff2 supports variations'), url(/fonts/fira-code.woff2) format('woff2-variations'), url(/fonts/fira-code.woff2) format('woff2')",
    fontWeight: "100 900",
    // Give Fira Code the same ascent/descent metrics as Inter. This means
    // `background-color`s, font sizes, line heights, everything set on the two
    // fonts line up when next to each other.
    ascentOverride: formatPercentage(interFontAscenderPercentage + interFontDescenderPercentage),
    descentOverride: formatPercentage(interFontDescenderPercentage),
});

const emojiFontFace = fontFace({
    // Emoji font stack is originally from: https://www.client9.com/css-color-emoji-stack/
    src: 'local("Apple Color Emoji"), local("Segoe UI Emoji"), local("NotoColorEmoji"), local("Noto Color Emoji"), local("Segoe UI Symbol"), local("Android Emoji"), local("EmojiSymbols")',
    // Use the same ascent/descent metrics for our emoji font face. This means
    // `background-color`s, font sizes, line heights, everything set on this font
    // will line up with our main font Inter.
    ascentOverride: formatPercentage(interFontAscenderPercentage + interFontDescenderPercentage),
    descentOverride: formatPercentage(interFontDescenderPercentage),
});

const fallbackFontFace = fontFace({
    src: 'local("Arial")',
    // Values taken from the fallback font `@next/font` generates for Inter.
    // We use the same fallback font for Inter and Fira Code because Fira Code
    // is resized to the same size as Inter.
    //
    // See:
    // https://beta.nextjs.org/docs/optimizing/fonts
    // https://github.com/vercel/next.js/blob/a6b40317294308f2d67240b789a8bbfcca694703/packages/font/src/google/loader.ts#L138-L148
    ascentOverride: "90.00%",
    descentOverride: "22.43%",
    lineGapOverride: "0.00%",
    sizeAdjust: "107.64%",
});

const interFontFamily = `${interFontFace}, ${fallbackFontFace}`;
const firaCodeFontFamily = `${firaCodeFontFace}, ${fallbackFontFace}`;
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
    // `extra-bold` and `ultra-bold` usually refer to the same thing but since
    // our bold weight starts at 600 we use `ultra-bold` as an intermediate value
    // to catch up.
    "ultra-bold": {
        fontFamily: interFontFamily,
        fontWeight: 800,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
    },
    black: {
        fontFamily: interFontFamily,
        fontWeight: 900,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
    },
    code: {
        fontFamily: firaCodeFontFamily,
        fontWeight: 400,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
    },
    "code-semi-bold": {
        fontFamily: firaCodeFontFamily,
        fontWeight: 500,
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
    "truncate-code": {
        fontFamily: firaCodeFontFamily,
        fontWeight: 400,
        fontStyle: "normal",
        fontFeatureSettings: '"calt" off',
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
