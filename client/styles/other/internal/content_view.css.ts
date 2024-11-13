import {globalStyle, style} from "@vanilla-extract/css";
import {colorSchemeVars, fontSizes, fontStyles} from "~/client/styles/core/styles_core.js";
import {paragraphFontSize} from "~/client/styles/other/internal/content.css.js";
import {paragraphClassName} from "~/shared/content/content_styles.js";

export const truncatedHeight = paragraphFontSize.lineHeight;

// TODO(calebmer): We should have a playground for truncated text with all our
// styles to make sure it looks right. Consider adding this when creating the
// table and code block styles.
export const truncatedClassName = style({
    height: truncatedHeight,
    overflow: "hidden",
});

globalStyle(`${truncatedClassName} ${paragraphClassName}`, {
    height: truncatedHeight,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
});

export const updatedNoteClassName = style({
    ...fontSizes["50"],
    color: colorSchemeVars["grey-50"],
    cursor: "default",
    // If this is selectable, it messes with `<ContentView>` copy logic.
    userSelect: "none",
});

export const seeButtonClassName = style({
    ...paragraphFontSize,
    ...fontStyles["semi-bold"],
    cursor: "pointer",
    userSelect: "none",
    color: colorSchemeVars["grey-90"],
});

export const seeButtonPressedClassName = style({
    opacity: 0.6,
});
