/**
 * CSS box shadows used to simulate elevation in our product.
 *
 * Our elevation system is taken from [Tailwind CSS][1] with some tweaks.
 *
 * - Light mode and dark mode versions. The dark mode versions have a higher
 *   opacity to make them possible to see.
 * - Light mode uses the same hue as our darkest grey color.
 * - Thin border added around all but `elevation-5` to increase definition of
 *   an element with just an elevation, no border.
 *
 * [1]: https://tailwindcss.com/docs/box-shadow
 */
export const elevation = {
    "elevation-5": {
        light: "0 1px 2px 0 rgb(18 18 20 / 0.05)",
        dark: "0 1px 2px 0 rgb(0 0 0 / 0.2)",
    },
    "elevation-10": {
        light: "0 1px 3px 0 rgb(18 18 20 / 0.1), 0 1px 2px -1px rgb(18 18 20 / 0.1), 0 0px 1px rgb(18 18 20 / 0.2)",
        dark: "0 1px 3px 0 rgb(0 0 0 / 0.3), 0 1px 2px -1px rgb(0 0 0 / 0.3)",
    },
    "elevation-20": {
        light: "0 4px 6px -1px rgb(18 18 20 / 0.1), 0 2px 4px -2px rgb(18 18 20 / 0.1), 0 0px 1px rgb(18 18 20 / 0.2)",
        dark: "0 4px 6px -1px rgb(0 0 0 / 0.3), 0 2px 4px -2px rgb(0 0 0 / 0.3)",
    },
    "elevation-30": {
        light: "0 10px 15px -3px rgb(18 18 20 / 0.1), 0 4px 6px -4px rgb(18 18 20 / 0.1), 0 0px 1px rgb(18 18 20 / 0.2)",
        dark: "0 10px 15px -3px rgb(0 0 0 / 0.3), 0 4px 6px -4px rgb(0 0 0 / 0.3)",
    },
    "elevation-40": {
        light: "0 20px 25px -5px rgb(18 18 20 / 0.1), 0 8px 10px -6px rgb(18 18 20 / 0.1), 0 0px 1px rgb(18 18 20 / 0.2)",
        dark: "0 20px 25px -5px rgb(0 0 0 / 0.3), 0 8px 10px -6px rgb(0 0 0 / 0.3)",
    },
    "elevation-50": {
        light: "0 25px 50px -12px rgb(18 18 20 / 0.25), 0 0px 1px rgb(18 18 20 / 0.2)",
        dark: "0 25px 50px -12px rgb(0 0 0 / 0.8)",
    },
    // A lighter variant of `elevation-10`. It's meant for small elevated elements
    // like a tooltip. Physically the analogy is the element weighs less or lets
    // some light through (like paper).
    "elevation-10-light": {
        light: "0 1px 3px 0 rgb(18 18 20 / 0.05), 0 1px 2px -1px rgb(18 18 20 / 0.05), 0 0px 1px rgb(18 18 20 / 0.2)",
        dark: "0 1px 3px 0 rgb(0 0 0 / 0.2), 0 1px 2px -1px rgb(0 0 0 / 0.2)",
    },
} as const;
