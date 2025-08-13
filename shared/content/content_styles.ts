// Since `shared/content` can't depend on `client/styles` (which is our client
// only CSS bundle) we can't import Vanilla Extract generated CSS names. So
// instead declare all the CSS names `shared/content` needs in this file and
// we'll implement them in `client/styles`.
//
// Only add class names to this file which you need to use in a `toDOM`
// function in a ProseMirror schema! Otherwise use the `style({})` function in
// a `.css.ts` file to automatically generate a class name.

import {HighlightColor} from "~/shared/design/core/highlight_color.js";

export const boldClassName = process.env.NODE_ENV !== "production" ? "content_bold" : "c_b";

export const codeClassName = process.env.NODE_ENV !== "production" ? "content_code" : "c_c";

export const italicClassName = process.env.NODE_ENV !== "production" ? "content_italic" : "c_i";

export const linkClassName = process.env.NODE_ENV !== "production" ? "content_link" : "c_l";

export const strikeClassName = process.env.NODE_ENV !== "production" ? "content_strike" : "c_s";

export const commentClassName = process.env.NODE_ENV !== "production" ? "content_comment" : "c_c2";

export const highlightClassNameByColor: {[Key in HighlightColor]: string} =
    process.env.NODE_ENV !== "production"
        ? {
              red: "content_highlightRed",
              orange: "content_highlightOrange",
              green: "content_highlightGreen",
              blue: "content_highlightBlue",
              purple: "content_highlightPurple",
          }
        : {
              red: "c_hr",
              orange: "c_ho",
              green: "c_hg",
              blue: "c_hb",
              purple: "c_hp",
          };

export const paragraphClassName =
    process.env.NODE_ENV !== "production" ? "content_paragraph" : "c_p";

export const listItemClassName =
    process.env.NODE_ENV !== "production" ? "content_listItem" : "c_li";

export const listItemIndentationVar =
    process.env.NODE_ENV !== "production" ? "var(--content_listItemIndentation)" : "var(--c_lii)";

export const unorderedListItemClassName =
    process.env.NODE_ENV !== "production" ? "content_unorderedListItem" : "c_uli";

export const orderedListItemClassName =
    process.env.NODE_ENV !== "production" ? "content_orderedListItem" : "c_oli";

export const checkListItemCheckedClassName =
    process.env.NODE_ENV !== "production" ? "content_checkListItemChecked" : "c_clic";

export const quoteBlockClassName =
    process.env.NODE_ENV !== "production" ? "content_quoteBlock" : "c_qb";

export const codeBlockWrapperClassName =
    process.env.NODE_ENV !== "production" ? "content_codeBlockWrapper" : "c_cbw";

export const codeBlockWrapper2ClassName =
    process.env.NODE_ENV !== "production" ? "content_codeBlockWrapper2" : "c_cbw2";

export const codeBlockClassName =
    process.env.NODE_ENV !== "production" ? "content_codeBlock" : "c_cb";

export const codeBlockLineClassName =
    process.env.NODE_ENV !== "production" ? "content_codeBlockLine" : "c_cbl";

export const codeBlockLineContentClassName =
    process.env.NODE_ENV !== "production" ? "content_codeBlockLineContent" : "c_cblc";

export const dividerClassName = process.env.NODE_ENV !== "production" ? "content_divider" : "c_d";

export const titleClassName = process.env.NODE_ENV !== "production" ? "content_title" : "c_t";

export const headingLevel1ClassName =
    process.env.NODE_ENV !== "production" ? "content_headingLevel1" : "c_h1";

export const headingLevel2ClassName =
    process.env.NODE_ENV !== "production" ? "content_headingLevel2" : "c_h2";

export const headingLevel3ClassName =
    process.env.NODE_ENV !== "production" ? "content_headingLevel3" : "c_h3";

export const fileRowLikeClassName =
    process.env.NODE_ENV !== "production" ? "content_fileRowLike" : "c_fr";

export const fileFloatClassName =
    process.env.NODE_ENV !== "production" ? "content_fileFloat" : "c_ff";

export const fileFloatLeftClassName =
    process.env.NODE_ENV !== "production" ? "content_fileFloatLeft" : "c_ffl";

export const fileFloatRightClassName =
    process.env.NODE_ENV !== "production" ? "content_fileFloatRight" : "c_ffr";

export const fileClassName = process.env.NODE_ENV !== "production" ? "content_file" : "c_f";

export const tableWrapperClassName =
    process.env.NODE_ENV !== "production" ? "content_tableWrapper" : "c_tw";

export const tableWrapper2ClassName =
    process.env.NODE_ENV !== "production" ? "content_tableWrapper2" : "c_tw2";

export const tableWrapper3ClassName =
    process.env.NODE_ENV !== "production" ? "content_tableWrapper3" : "c_tw3";

// TODO: Maybe this blob class should go into its own file someday? Maybe
// we should rename this file to something more generic like
// `static_class_names.ts`?
export const blobsArtGradientClassName =
    process.env.NODE_ENV !== "production" ? "blobs_gradient" : "b_g";
