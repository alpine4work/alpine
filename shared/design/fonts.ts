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
    tiny: {
        fontSize: "0.625rem",
        lineHeight: "1rem",
        letterSpacing: "0.03em",
    },
    small: {
        fontSize: "0.75rem",
        lineHeight: "1rem",
        letterSpacing: "0.02em",
    },
    body: {
        fontSize: "1rem",
        lineHeight: "1.5rem",
        letterSpacing: "0em",
    },
    heading5: {
        fontSize: "1.25rem",
        lineHeight: "2rem",
        letterSpacing: "0em",
    },
    heading4: {
        fontSize: "1.75rem",
        lineHeight: "2rem",
        letterSpacing: "0em",
    },
    heading3: {
        fontSize: "2.25rem",
        lineHeight: "2.5rem",
        letterSpacing: "0em",
    },
    heading2: {
        fontSize: "3rem",
        lineHeight: "3rem",
        letterSpacing: "0em",
    },
    heading1: {
        fontSize: "4.25rem",
        lineHeight: "4.5rem",
        letterSpacing: "0em",
    },
    hero3: {
        fontSize: "5.625rem",
        lineHeight: "5.5rem",
        letterSpacing: "0em",
    },
    hero2: {
        fontSize: "7.5rem",
        lineHeight: "7rem",
        letterSpacing: "0em",
    },
    hero1: {
        fontSize: "10rem",
        lineHeight: "9rem",
        letterSpacing: "0em",
    },
} as const;

/**
 * Font weights at our disposal.
 */
export const fontWeights = {
    normal: 400,
    bold: 600,
};
