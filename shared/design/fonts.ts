/*!
 * Our body font family is [Inter][1] and our code font family is
 * [Fira Code][2] (with ligatures disabled).
 *
 * We use the `@next/font` library to bring these fonts into our project since
 * that library applies many performance optimizations. However we can't use
 * that library in `.css.ts` files so we import the fonts in our
 * `_app.page.tsx` file.
 *
 * In `_app.page.tsx` we set Inter as the body font globally and we set
 * Fira Code to a CSS variable we use when there's a monospace font.
 *
 * [1]: https://rsms.me/inter
 * [2]: https://github.com/tonsky/FiraCode
 */

// TODO(calebmer): Some characters aren't quite working with `@next/font`.
// https://github.com/vercel/next.js/issues/41923

/**
 * The fonts available in our product.
 *
 * We use `@next/font` to make our fonts available. This library needs to run
 * in browser code (as opposed to `.css.ts`) so font families are assigned to
 * CSS variables in `_app.page.tsx`.
 */
export const fonts = {
    primary: {
        fontFamily: "var(--inter)",
        fontWeight: 400,
        fontStyle: "normal",
    },
    primaryMedium: {
        fontFamily: "var(--inter)",
        fontWeight: 500,
        fontStyle: "normal",
    },
    primarySemiBold: {
        fontFamily: "var(--inter)",
        fontWeight: 600,
        fontStyle: "normal",
    },
    primaryBold: {
        fontFamily: "var(--inter)",
        fontWeight: 700,
        fontStyle: "normal",
    },
    code: {
        fontFamily: "var(--fira-code)",
        fontWeight: 400,
        fontStyle: "normal",
    },
    codeBold: {
        fontFamily: "var(--fira-code)",
        fontWeight: 700,
        fontStyle: "normal",
    },
};

/**
 * Line height is 1.4x for all sizes except `small`. For `small` the line
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
