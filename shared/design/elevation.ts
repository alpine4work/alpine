// Our elevation system was derived from the Atlassian design system's
// elevation tokens.
// https://bitbucket.org/atlassian/atlassian-frontend-mirror/src/26522ba48f433282e5c966bfe7adb3b1ff315a43/design-system/theme/src/elevation.tsx#lines-20:65

/**
 * CSS box shadows used to simulate elevation in our product.
 */
export const elevation = {
    // Inline dialogs
    "elevation-20": {
        light: "0 4px 8px -2px rgba(0, 0, 0, 0.25), 0 0 1px rgba(0, 0, 0, 0.31)",
        dark: "0 4px 8px -2px rgba(0, 0, 0, 0.85), 0 0 1px rgba(0, 0, 0, 0.81)",
    },
    // Modals
    "elevation-30": {
        light: "0 8px 16px -4px rgba(0, 0, 0, 0.25), 0 0 1px rgba(0, 0, 0, 0.31)",
        dark: "0 8px 16px -4px rgba(0, 0, 0, 0.85), 0 0 1px rgba(0, 0, 0, 0.81)",
    },
    // Panels
    "elevation-40": {
        light: "0 12px 24px -6px rgba(0, 0, 0, 0.25), 0 0 1px rgba(0, 0, 0, 0.31)",
        dark: "0 12px 24px -6px rgba(0, 0, 0, 0.85), 0 0 1px rgba(0, 0, 0, 0.81)",
    },
    // Notifications
    "elevation-50": {
        light: "0 20px 32px -8px rgba(0, 0, 0, 0.25), 0 0 1px rgba(0, 0, 0, 0.31)",
        dark: "0 20px 32px -8px rgba(0, 0, 0, 0.85), 0 0 1px rgba(0, 0, 0, 0.81)",
    },
} as const;
