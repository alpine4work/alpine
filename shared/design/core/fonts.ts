/* eslint-disable string-quotes */

/**
 * The typography styles available in our product.
 *
 * We only allow certain combinations of font families and weights
 * for performance.
 *
 * Though for variable fonts we may provide more style variants since
 * they're free to add.
 */
export function createFontStyles({
    interFontFamily,
    commitMonoFontFamily,
}: {
    interFontFamily: string;
    commitMonoFontFamily: string;
}) {
    return {
        light: {
            fontFamily: interFontFamily,
            fontWeight: 300,
            fontStyle: "normal",
            // You must manually enable `calt` to get contextual alternatives.
            fontFeatureSettings: '"calt" off',
            fontSynthesis: "none",
        },
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
        "code-light": {
            fontFamily: commitMonoFontFamily,
            fontWeight: 275,
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
}

export type FontSize = keyof typeof fontSizesBySpacingScale;

/**
 * Font scale computed with the following:
 * https://www.desmos.com/calculator/rewoqdxtac
 */
export const fontSizesBySpacingScale = {
    "25": {
        small: {
            fontSize: 10,
            letterSpacing: "0.01em",
            lineHeight: "0.75rem",
        },
        medium: {
            fontSize: 11,
            letterSpacing: "0.0048em",
            lineHeight: "0.75rem",
        },
        large: {
            fontSize: 13,
            letterSpacing: "-0.0032em",
            lineHeight: "0.75rem",
        },
    },
    "50": {
        small: {
            fontSize: 11,
            letterSpacing: "0.0048em",
            lineHeight: "0.875rem",
        },
        medium: {
            fontSize: 12,
            letterSpacing: "0.0005em",
            lineHeight: "0.875rem",
        },
        large: {
            fontSize: 14,
            letterSpacing: "-0.0062em",
            lineHeight: "0.875rem",
        },
    },
    "75": {
        small: {
            fontSize: 12,
            letterSpacing: "0.0005em",
            lineHeight: "1rem",
        },
        medium: {
            fontSize: 14,
            letterSpacing: "-0.0062em",
            lineHeight: "1rem",
        },
        large: {
            fontSize: 15,
            letterSpacing: "-0.0088em",
            lineHeight: "1rem",
        },
    },
    "100": {
        small: {
            fontSize: 14,
            letterSpacing: "-0.0062em",
            lineHeight: "1.25rem",
        },
        medium: {
            fontSize: 16,
            letterSpacing: "-0.011em",
            lineHeight: "1.25rem",
        },
        large: {
            // 17px is the default size for text on iOS according to the [Human Interface
            // Guidelines][1]. According to our font scale math this value should be 18px
            // but that looks a little too large so we manually adjust down to 17px.
            //
            // [1]: https://developer.apple.com/design/human-interface-guidelines/typography#Specifications
            fontSize: 17,
            letterSpacing: "-0.0128em",
            lineHeight: "1.25rem",
        },
    },
    "200": {
        small: {
            fontSize: 16,
            letterSpacing: "-0.011em",
            lineHeight: "1.5rem",
        },
        medium: {
            fontSize: 18,
            letterSpacing: "-0.0143em",
            lineHeight: "1.5rem",
        },
        large: {
            fontSize: 20,
            letterSpacing: "-0.0167em",
            lineHeight: "1.5rem",
        },
    },
    "300": {
        small: {
            fontSize: 18,
            letterSpacing: "-0.0143em",
            lineHeight: "1.625rem",
        },
        medium: {
            fontSize: 20,
            letterSpacing: "-0.0167em",
            lineHeight: "1.625rem",
        },
        large: {
            fontSize: 22,
            letterSpacing: "-0.0183em",
            lineHeight: "1.625rem",
        },
    },
    // Font size in between 300 and 400 used for our heading scale on mobile.
    // Should only be used for mobile headings, not considered a part of our
    // general typography scale.
    "350-narrow-heading": {
        small: {
            fontSize: 19,
            letterSpacing: "-0.0156em",
            lineHeight: "1.625rem",
        },
        medium: {
            fontSize: 21,
            letterSpacing: "-0.0176em",
            lineHeight: "1.625rem",
        },
        large: {
            fontSize: 23,
            letterSpacing: "-0.019em",
            lineHeight: "1.625rem",
        },
    },
    "400": {
        small: {
            fontSize: 20,
            letterSpacing: "-0.0167em",
            lineHeight: "1.75rem",
        },
        medium: {
            fontSize: 22,
            letterSpacing: "-0.0183em",
            lineHeight: "1.75rem",
        },
        large: {
            fontSize: 25,
            letterSpacing: "-0.0199em",
            lineHeight: "1.75rem",
        },
    },
    "500": {
        small: {
            fontSize: 22,
            letterSpacing: "-0.0183em",
            lineHeight: "1.875rem",
        },
        medium: {
            fontSize: 25,
            letterSpacing: "-0.0199em",
            lineHeight: "1.875rem",
        },
        large: {
            fontSize: 28,
            letterSpacing: "-0.0209em",
            lineHeight: "1.875rem",
        },
    },
    "600": {
        small: {
            fontSize: 25,
            letterSpacing: "-0.0199em",
            lineHeight: "2.125rem",
        },
        medium: {
            fontSize: 28,
            letterSpacing: "-0.0209em",
            lineHeight: "2.125rem",
        },
        large: {
            fontSize: 31,
            letterSpacing: "-0.0215em",
            lineHeight: "2.125rem",
        },
    },
    "700": {
        small: {
            fontSize: 28,
            letterSpacing: "-0.0209em",
            lineHeight: "2.25rem",
        },
        medium: {
            fontSize: 32,
            letterSpacing: "-0.0216em",
            lineHeight: "2.25rem",
        },
        large: {
            fontSize: 35,
            letterSpacing: "-0.0219em",
            lineHeight: "2.25rem",
        },
    },
    "800": {
        small: {
            fontSize: 32,
            letterSpacing: "-0.0216em",
            lineHeight: "2.5rem",
        },
        medium: {
            fontSize: 36,
            letterSpacing: "-0.022em",
            lineHeight: "2.5rem",
        },
        large: {
            fontSize: 40,
            letterSpacing: "-0.0221em",
            lineHeight: "2.5rem",
        },
    },
    "900": {
        small: {
            fontSize: 36,
            letterSpacing: "-0.022em",
            lineHeight: "2.75rem",
        },
        medium: {
            fontSize: 40,
            letterSpacing: "-0.0221em",
            lineHeight: "2.75rem",
        },
        large: {
            fontSize: 45,
            letterSpacing: "-0.0222em",
            lineHeight: "2.75rem",
        },
    },
    "1000": {
        small: {
            fontSize: 40,
            letterSpacing: "-0.0221em",
            lineHeight: "3rem",
        },
        medium: {
            fontSize: 45,
            letterSpacing: "-0.0222em",
            lineHeight: "3rem",
        },
        large: {
            fontSize: 50,
            letterSpacing: "-0.0223em",
            lineHeight: "3rem",
        },
    },
    "1100": {
        small: {
            fontSize: 45,
            letterSpacing: "-0.0222em",
            lineHeight: "3.375rem",
        },
        medium: {
            fontSize: 51,
            letterSpacing: "-0.0223em",
            lineHeight: "3.375rem",
        },
        large: {
            fontSize: 56,
            letterSpacing: "-0.0223em",
            lineHeight: "3.375rem",
        },
    },
    "1200": {
        small: {
            fontSize: 50,
            letterSpacing: "-0.0223em",
            lineHeight: "3.75rem",
        },
        medium: {
            fontSize: 56,
            letterSpacing: "-0.0223em",
            lineHeight: "3.75rem",
        },
        large: {
            fontSize: 62,
            letterSpacing: "-0.0223em",
            lineHeight: "3.75rem",
        },
    },
    "1300": {
        small: {
            fontSize: 60,
            letterSpacing: "-0.0223em",
            lineHeight: "4.5rem",
        },
        medium: {
            fontSize: 68,
            letterSpacing: "-0.0223em",
            lineHeight: "4.5rem",
        },
        large: {
            fontSize: 75,
            letterSpacing: "-0.0223em",
            lineHeight: "4.5rem",
        },
    },
} as const;
