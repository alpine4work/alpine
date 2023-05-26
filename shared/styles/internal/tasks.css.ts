import {globalStyle, style} from "@vanilla-extract/css";
import {spacing} from "~/shared/design/spacing";
import {omitObject} from "~/shared/helpers/object/omit_object";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css";
import {inputPlaceholderStyles} from "~/shared/styles/internal/input_placeholder.css";

export const textCursorNotInheritedClassName = style({
    cursor: "text",
});

globalStyle(`${textCursorNotInheritedClassName} > *`, {
    cursor: "initial",
});

export const pointerEventsNoneNotInheritedClassName = style({
    pointerEvents: "none",
});

globalStyle(`${pointerEventsNoneNotInheritedClassName} > *`, {
    pointerEvents: "initial",
});

export const titleInputContainerClassName = style({
    position: "relative",
    zIndex: 0,
});

export const titleInputEmptyContainerClassName = style({});

export const titleInputPlaceholderClassName = style({
    position: "relative",
    zIndex: 0,
});

globalStyle(`${titleInputEmptyContainerClassName} > ${titleInputPlaceholderClassName}::before`, {
    // The `/ ""` is screen reader alt text. So screen readers don't read the
    // placeholder content.
    //
    // Not all browsers support that syntax, though (like Safari), so we provide a
    // fallback without the `/ ""`.
    content: ["attr(aria-placeholder)", 'attr(aria-placeholder) / ""'],
    pointerEvents: "none",
    // Uses a bold font weight for the title.
    ...omitObject(inputPlaceholderStyles, ["fontWeight"]),
    position: "absolute",
    // Make sure placeholder is rendered underneath cursor.
    zIndex: -10,
});

export const titleInputOverflowGradientLeftContainerClassName = style({
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

export const titleInputOverflowGradientRightContainerClassName = style({
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
