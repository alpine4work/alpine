import {globalStyle, style} from "@vanilla-extract/css";
import {inputPlaceholderColor} from "~/shared/styles/internal/input_placeholder_color.css";

export const emptyClassName = style({});

export const placeholderClassName = style({
    position: "relative",
    zIndex: 0,
});

globalStyle(`${emptyClassName} > ${placeholderClassName}::before`, {
    // The `/ ""` is screen reader alt text. So screen readers don't read the
    // placeholder content.
    //
    // Not all browsers support that syntax, though (like Safari), so we provide a
    // fallback without the `/ ""`.
    content: ["attr(aria-placeholder)", 'attr(aria-placeholder) / ""'],
    pointerEvents: "none",
    color: inputPlaceholderColor,
    position: "absolute",
    // Make sure placeholder is rendered underneath cursor.
    zIndex: -10,
});
