import {globalStyle, style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css.js";
import {
    extraCompactDocClassName,
    extraCompactParagraphFontSize,
    paragraphClassName,
    paragraphFontSize,
} from "~/shared/styles/internal/content_schema.css.js";
import {fontSizes, fontStyles} from "~/shared/styles/internal/fonts.css.js";

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
});

export const seeButtonClassName = style({
    ...paragraphFontSize,
    ...fontStyles["semi-bold"],
    cursor: "pointer",
    userSelect: "none",
    selectors: {
        [`${extraCompactDocClassName} &`]: {
            ...extraCompactParagraphFontSize,
        },
    },
});

export const seeButtonPressedClassName = style({
    opacity: 0.6,
});
