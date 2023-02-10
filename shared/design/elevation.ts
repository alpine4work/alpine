/**
 * CSS box shadows used to simulate elevation in our product.
 */
export const elevation = {
    "elevation-5": {
        light: "0px 1px 2px 0px rgb(18 18 20 / 0.05), 0 0 0 1px rgb(0 0 0 / 0.025)",
        dark: "0px 1px 2px 0px rgb(0 0 0 / 0.15)",
    },
    "elevation-10": {
        light: "0px 1px 3px 0px rgb(18 18 20 / 0.1), 0px 1px 2px 0px rgb(18 18 20 / 0.06), 0 0 0 1px rgb(0 0 0 / 0.025)",
        dark: "0px 1px 3px 0px rgb(0 0 0 / 0.3), 0px 1px 2px 0px rgb(0 0 0 / 0.18)",
    },
    "elevation-20": {
        light: "0px 4px 8px -2px rgb(18 18 20 / 0.1), 0px 2px 4px -2px rgb(18 18 20 / 0.06), 0 0 0 1px rgb(0 0 0 / 0.04)",
        dark: "0px 4px 8px -2px rgb(0 0 0 / 0.3), 0px 2px 4px -2px rgb(0 0 0 / 0.18)",
    },
    "elevation-30": {
        light: "0px 12px 16px -4px rgb(18 18 20 / 0.08), 0px 4px 6px -2px rgb(18 18 20 / 0.03), 0 0 0 1px rgb(0 0 0 / 0.04)",
        dark: "0px 12px 16px -4px rgb(0 0 0 / 0.24), 0px 4px 6px -2px rgb(0 0 0 / 0.09)",
    },
    "elevation-40": {
        light: "0px 20px 24px -4px rgb(18 18 20 / 0.08), 0px 8px 8px -4px rgb(18 18 20 / 0.03), 0 0 0 1px rgb(0 0 0 / 0.04)",
        dark: "0px 20px 24px -4px rgb(0 0 0 / 0.24), 0px 8px 8px -4px rgb(0 0 0 / 0.09)",
    },
    "elevation-50": {
        light: "0px 24px 48px -12px rgb(18 18 20 / 0.18), 0 0 0 1px rgb(0 0 0 / 0.04)",
        dark: "0px 24px 48px -12px rgb(0 0 0 / 0.46)",
    },
    "elevation-60": {
        light: "0px 32px 64px -12px rgb(18 18 20 / 0.14), 0 0 0 1px rgb(0 0 0 / 0.04)",
        dark: "0px 32px 64px -12px rgb(0 0 0 / 0.38)",
    },
} as const;
