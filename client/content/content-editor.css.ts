import {style} from "@vanilla-extract/css";

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
