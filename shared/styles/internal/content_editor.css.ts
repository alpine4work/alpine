import {globalStyle, style} from "@vanilla-extract/css";
import {linkClassName, mentionClassName} from "~/shared/styles/internal/content_schema.css.js";
import {backgroundFontSizePercentage} from "~/shared/styles/internal/fonts.css.js";

export const containerClassName = style({
    minHeight: "100%",
});

/**
 * When applying a background color to some selected text, we want the
 * background to cover the entire line height, not just the size of the inline
 * element as determined by the browser.
 *
 * These styles using padding top/bottom to grow the inline element height to
 * the line height.
 */
export const inlineElementPaddingToLineHeightClassName = style({
    paddingTop: `${(backgroundFontSizePercentage - 1) / 2}em`,
    paddingBottom: `${(backgroundFontSizePercentage - 1) / 2}em`,
});

// We use our `<FocusRing>` class for highlighting a selected node.
globalStyle(".ProseMirror-selectednode", {
    outline: "none !important",
});

export const shiftKeyOrAltKeyDownClassName = style({});

// When the shift or alt key is down then clicking on a link will select the
// underlying text instead of opening it as a link. So show a regular text
// cursor instead of a pointer cursor.
globalStyle(`${shiftKeyOrAltKeyDownClassName} a${linkClassName}`, {
    cursor: "inherit",
});

// TODO(calebmer): I feel like we should have some kind of style here to make
// it clear where the end of the mention is? Or modify the mention logic so we
// are less forgiving of spaces and arrow key movements.
export const inlineMentionInputClassName = style({});

// Mentions must be selected all at once when in an editor. You may not select
// in the middle of a mention.
globalStyle(`${containerClassName} ${mentionClassName}`, {
    userSelect: "all",
});
