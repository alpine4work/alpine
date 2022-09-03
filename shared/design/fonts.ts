/**
 * The font family for sans-serif text in our product.
 *
 * We use a system font stack so that our product feels natural in the user's
 * operating system. And to improve page load performance.
 */
export const sansSerifFontFamily =
    'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

/**
 * The font family for monospace text in our product.
 *
 * We use a system font stack so that our product feels natural in the user's
 * operating system. And to improve page load performance.
 */
export const monospaceFontFamily =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/**
 * The font scale for our product.
 */
export const fontScale = {
    xs: {
        fontSize: "0.5rem",
        lineHeight: "1rem",
        letterSpacing: "0.04em",
    },
    sm: {
        fontSize: "0.75rem",
        lineHeight: "1.125rem",
        letterSpacing: "0.01em",
    },
    base: {
        fontSize: "1rem",
        lineHeight: "1.5rem",
        letterSpacing: "0em",
    },
    lg: {
        fontSize: "1.5rem",
        lineHeight: "2rem",
        letterSpacing: "0em",
    },
    xl: {
        fontSize: "2rem",
        lineHeight: "2.5rem",
        letterSpacing: "0em",
    },
    "2xl": {
        fontSize: "3rem",
        lineHeight: "3.5rem",
        letterSpacing: "0em",
    },
    "3xl": {
        fontSize: "4rem",
        lineHeight: "4.5rem",
        letterSpacing: "-0.01em",
    },
    "4xl": {
        fontSize: "6rem",
        lineHeight: "6.5rem",
        letterSpacing: "-0.02em",
    },
} as const;

/**
 * Font weights at our disposal.
 */
export const fontWeights = {
    normal: 400,
    bold: 600,
};
