// We get our elevation values from TailwindCSS
// https://tailwindcss.com/docs/box-shadow

/**
 * CSS box shadows used to simulate elevation in our product.
 */
export const elevation = {
    "elevation-5": "0 1px 2px 0 rgb(0 0 0 / 0.05), 0 0 1px rgb(0 0 0 / 0.3)",
    "elevation-10":
        "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1), 0 0 1px rgb(0 0 0 / 0.3)",
    "elevation-20":
        "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1), 0 0 1px rgb(0 0 0 / 0.3)",
    "elevation-30":
        "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1), 0 0 1px rgb(0 0 0 / 0.3)",
    "elevation-40":
        "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1), 0 0 1px rgb(0 0 0 / 0.3)",
    "elevation-50": "0 25px 50px -12px rgb(0 0 0 / 0.25), 0 0 1px rgb(0 0 0 / 0.2)",
} as const;

/**
 * Save as `elevation-20` but with less opacity because tooltips are smaller
 * and lighter.
 */
export const tooltipBoxShadow =
    "0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05), 0 0 1px rgb(0 0 0 / 0.3)";
