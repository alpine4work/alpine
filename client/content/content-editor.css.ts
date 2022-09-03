import {globalStyle, style} from "@vanilla-extract/css";
import {headerBottomMargin, titleClassName} from "~/shared/content/content-schema.css";
import {colorSchemeVars} from "~/shared/design/color-scheme.css";
import {fontScale, fontWeights} from "~/shared/design/fonts";
import {parseRemLengthNumber} from "~/shared/design/spacing";

export const emptyTitleClassName = style({});

globalStyle(`${emptyTitleClassName}[aria-placeholder] > ${titleClassName}::before`, {
    content: "Untitled",
    position: "absolute",
    top: 0,
    left: 0,
    pointerEvents: "none",
    color: colorSchemeVars["grey-20"],
    ...fontScale["2xl"],
    fontWeight: fontWeights.bold,
});

export const emptyBodyClassName = style({});

globalStyle(`${emptyBodyClassName}[aria-placeholder]::before`, {
    content: "attr(aria-placeholder)",
    position: "absolute",
    top: `${
        parseRemLengthNumber(fontScale["2xl"].lineHeight) + parseRemLengthNumber(headerBottomMargin)
    }rem`,
    left: 0,
    pointerEvents: "none",
    color: colorSchemeVars["grey-30"],
    ...fontScale.base,
});

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

// We use our `<FocusRing>` class for highlighting a selected node.
globalStyle(".ProseMirror-selectednode", {
    outline: "none",
});
