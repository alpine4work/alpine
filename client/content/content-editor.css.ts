import {globalStyle, style} from "@vanilla-extract/css";
import {
    paragraphMargin,
    titleClassName,
    titlePaddingTop,
} from "~/shared/content/content-schema.css";
import {colorSchemeVars} from "~/shared/design/color-scheme.css";
import {fontScale, fontWeights} from "~/shared/design/fonts";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing";

export const containerClassName = style({
    height: "100%",
});

export const emptyTitleClassName = style({});

globalStyle(`${emptyTitleClassName}[aria-placeholder] > ${titleClassName}::before`, {
    content: "Untitled",
    position: "absolute",
    top: titlePaddingTop,
    left: "50%",
    transform: "translateX(-50%)",
    width: "100%",
    maxWidth: spacing["192"],
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
        parseRemLengthNumber(titlePaddingTop) +
        parseRemLengthNumber(fontScale["2xl"].lineHeight) +
        parseRemLengthNumber(paragraphMargin)
    }rem`,
    left: "50%",
    transform: "translateX(-50%)",
    width: "100%",
    maxWidth: spacing["192"],
    marginLeft: "auto",
    marginRight: "auto",
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
    // Really careful padding to try and get our background color height to match
    // the height of the operating system text selection. Only tested on MacOS so
    // far. Maybe there's a better way?
    paddingTop: `calc(${
        (parseRemLengthNumber(fontScale.base.lineHeight) -
            parseRemLengthNumber(fontScale.base.fontSize)) /
        2
    }rem - 2px)`,
    paddingBottom: `calc(${
        (parseRemLengthNumber(fontScale.base.lineHeight) -
            parseRemLengthNumber(fontScale.base.fontSize)) /
        2
    }rem - 1px)`,
});

// We use our `<FocusRing>` class for highlighting a selected node.
globalStyle(".ProseMirror-selectednode", {
    outline: "none",
});
