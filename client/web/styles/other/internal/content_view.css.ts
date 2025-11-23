import {style} from "@vanilla-extract/css";
import {colorSchemeVars, fontSizes, fontStyles} from "~/client/web/styles/core/styles_core.js";
import {paragraphFontSize} from "~/client/web/styles/other/internal/content.css.js";

export const updatedNoteClassName = style({
    ...fontSizes["50"],
    color: colorSchemeVars["grey-50"],
    cursor: "default",
    // If this is selectable, it messes with `<ContentView>` copy logic.
    userSelect: "none",
});

export const updatedNotePlaceholderClassName = style({
    selectors: {
        "&::after": {
            content: '" (edited)"',
            ...fontSizes["50"],
            color: colorSchemeVars["grey-50"],
            visibility: "hidden",
            pointerEvents: "none",
        },
    },
});

export const seeButtonClassName = style({
    ...paragraphFontSize,
    ...fontStyles["semi-bold"],
    cursor: "pointer",
    userSelect: "none",
    color: colorSchemeVars["grey-90"],
    // Don't allow "See more" and "See less" text to wrap onto separate lines.
    whiteSpace: "nowrap",
});

export const seeButtonPressedClassName = style({
    opacity: 0.6,
});
