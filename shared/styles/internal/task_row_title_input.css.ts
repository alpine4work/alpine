import {globalStyle, style} from "@vanilla-extract/css";
import {spacing} from "~/shared/design/spacing";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css";
import {inputPlaceholderColor} from "~/shared/styles/internal/input_placeholder_color.css";

export const containerClassName = style({
    position: "relative",
    zIndex: 0,
});

export const emptyContainerClassName = style({});

export const placeholderClassName = style({
    position: "relative",
    zIndex: 0,
});

globalStyle(`${emptyContainerClassName} > ${placeholderClassName}::before`, {
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

export const overflowGradientLeftContainerClassName = style({
    selectors: {
        "&::before": {
            content: '""',
            position: "absolute",
            zIndex: 20,
            top: 0,
            // Bottom 1px to avoid overlapping border.
            bottom: 1,
            left: 0,
            width: spacing["3"],
            background: `linear-gradient(to right, ${colorSchemeVars["grey-0"]}, transparent)`,
        },
    },
});

export const overflowGradientRightContainerClassName = style({
    selectors: {
        "&::after": {
            content: '""',
            position: "absolute",
            zIndex: 20,
            top: 0,
            // Bottom 1px to avoid overlapping border.
            bottom: 1,
            right: 0,
            width: spacing["3"],
            background: `linear-gradient(to left, ${colorSchemeVars["grey-0"]}, transparent)`,
        },
    },
});
