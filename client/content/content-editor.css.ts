import {globalStyle, style} from "@vanilla-extract/css";
import {inputPlaceholderColor} from "~/client/design/input-placeholder-color.css";
import {paragraphClassName, titleClassName} from "~/shared/content/content-schema.css";
import {colorSchemeVars} from "~/shared/design/color-scheme.css";
import {fontScale} from "~/shared/design/fonts";
import {parseRemLengthNumber} from "~/shared/design/spacing";

export const containerClassName = style({
    height: "100%",
});

export const emptyTitleClassName = style({});

globalStyle(`${emptyTitleClassName} > ${titleClassName}[data-placeholder]::before`, {
    // The `/ ""` is screen reader alt text. So screen readers don't read the
    // placeholder content.
    //
    // Not all browsers support that syntax, though (like Safari), so we provide a
    // fallback without the `/ ""`.
    content: ["attr(data-placeholder)", 'attr(data-placeholder) / ""'],
    pointerEvents: "none",
    color: inputPlaceholderColor,
    position: "absolute",
});

export const emptyBodyClassName = style({});

globalStyle(`${emptyBodyClassName} > ${paragraphClassName}[data-placeholder]::before`, {
    // The `/ ""` is screen reader alt text. So screen readers don't read the
    // placeholder content.
    //
    // Not all browsers support that syntax, though (like Safari), so we provide a
    // fallback without the `/ ""`.
    content: ["attr(data-placeholder)", 'attr(data-placeholder) / ""'],
    pointerEvents: "none",
    color: inputPlaceholderColor,
    position: "absolute",
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
        (parseRemLengthNumber(fontScale.body.lineHeight) -
            parseRemLengthNumber(fontScale.body.fontSize)) /
        2
    }rem - 2px)`,
    paddingBottom: `calc(${
        (parseRemLengthNumber(fontScale.body.lineHeight) -
            parseRemLengthNumber(fontScale.body.fontSize)) /
        2
    }rem - 1px)`,
});

// We use our `<FocusRing>` class for highlighting a selected node.
globalStyle(".ProseMirror-selectednode", {
    outline: "none",
});
