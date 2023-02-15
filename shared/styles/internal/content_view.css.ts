import {globalStyle, style} from "@vanilla-extract/css";
import {paragraphClassName, paragraphFontSize} from "~/shared/styles/internal/content_schema.css";

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
