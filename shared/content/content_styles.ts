// Since `shared/content` can't depend on `client/styles` (which is our client
// only CSS bundle) we can't import Vanilla Extract generated CSS names. So
// instead declare all the CSS names `shared/content` needs in this file and
// we'll implement them in `client/styles`.
//
// Only add class names to this file which you need to use in a `toDOM`
// function in a ProseMirror schema! Otherwise use the `style({})` function in
// a `.css.ts` file to automatically generate a class name.

import {HighlightColor} from "~/shared/design/highlight_color.js";

export const boldClassName = "content_bold";

export const codeClassName = "content_code";

export const italicClassName = "content_italic";

export const linkClassName = "content_link";

export const strikeClassName = "content_strike";

export const commentClassName = "content_comment";

export const highlightClassNameByColor: {[Key in HighlightColor]: string} = {
    red: "content_highlightRed",
    orange: "content_highlightOrange",
    green: "content_highlightGreen",
    blue: "content_highlightBlue",
    purple: "content_highlightPurple",
};

export const paragraphClassName = "content_paragraph";

export const listItemClassName = "content_listItem";

export const listItemIndentationVar = "var(--content_listItemIndentation)";

export const bulletListItemClassName = "content_bulletListItem";

export const orderedListItemClassName = "content_orderedListItem";

export const checkListItemCheckedClassName = "content_checkListItemChecked";

export const quoteBlockClassName = "content_quoteBlock";

export const codeBlockWrapperClassName = "content_codeBlockWrapper";

export const codeBlockClassName = "content_codeBlock";

export const codeBlockLineClassName = "content_codeBlockLine";

export const codeBlockLineContentClassName = "content_codeBlockLineContent";

export const dividerClassName = "content_divider";

export const titleClassName = "content_title";

export const headingLevel1ClassName = "content_headingLevel1";

export const headingLevel2ClassName = "content_headingLevel2";

export const headingLevel3ClassName = "content_headingLevel3";
