import {globalStyle, style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/shared/design/color-scheme.css";

export const emptyContentEditorClassName = style({});

// TODO(calebmer): Port this

// .empty[aria-placeholder] {
//     position: relative;
// }

// .empty[aria-placeholder] > p:first-child {
//     position: relative;
//     z-index: 2;
// }

// .empty[aria-placeholder]::before {
//     content: attr(aria-placeholder);
//     position: absolute;
//     left: 0;
//     right: 0;
//     padding-left: inherit;
//     padding-right: inherit;
//     z-index: 1;
//     pointer-events: none;
//     color: theme("colors.gray.300");
// }

export const hideSelectionWhileUnfocusedClassName = style({
    caretColor: "transparent",
});

globalStyle(`${hideSelectionWhileUnfocusedClassName} *::selection`, {background: "transparent"});
globalStyle(`${hideSelectionWhileUnfocusedClassName} *::-moz-selection`, {
    background: "transparent",
});

export const unfocusedSelectionClassName = style({
    backgroundColor: colorSchemeVars["grey-10"],
    // Make sure the background covers the entire line-height with an `inline-block` display type.
    display: "inline-block",
});
