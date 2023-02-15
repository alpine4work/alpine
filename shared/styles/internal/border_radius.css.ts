export type BorderRadius = keyof typeof borderRadius;

/**
 * Our border radius scale.
 */
export const borderRadius = {
    none: "0rem",
    sm: "0.125rem",
    base: "0.25rem",
    md: "0.375rem",
    // Half of `spacing["6"]` which is our `<MessageView>` minimum width. We use
    // this for message view bubbles.
    xl: "0.75rem",
    full: "9999px",
} as const;
