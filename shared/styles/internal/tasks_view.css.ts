import {globalStyle, style} from "@vanilla-extract/css";

export const textCursorNotInheritedClassName = style({
    cursor: "text",
});

globalStyle(`${textCursorNotInheritedClassName} > *`, {
    cursor: "initial",
});
