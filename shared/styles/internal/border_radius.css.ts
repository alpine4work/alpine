export type BorderRadius = keyof typeof borderRadius;

/**
 * Our border radius scale.
 */
export const borderRadius = {
    none: "0rem",
    "0.5": "0.125rem",
    "1": "0.25rem",
    "1.5": "0.375rem",
    "2": "0.5rem",
    "2.5": "0.625rem",
    "3": "0.75rem",
    "3.5": "0.875rem",
    "4": "1rem",
    full: "9999px",
} as const;
