import {globalStyle, style} from "@vanilla-extract/css";
import {spacing} from "~/shared/design/spacing.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css.js";
import {inputPlaceholderStyles} from "~/shared/styles/internal/input_placeholder.css.js";
import {sprinkles} from "~/shared/styles/internal/sprinkles.css.js";

export const textCursorNotInheritedClassName = style({
    cursor: "text",
});

globalStyle(`${textCursorNotInheritedClassName} > *`, {
    // Our `:root` cursor is explicitly set to `"default"` so `userSelect: "none"`
    // text always has a default cursor.
    cursor: "default",
});

export const textCursorNotInherited2ClassName = style({
    cursor: "text",
});

globalStyle(`${textCursorNotInherited2ClassName} > * > *`, {
    // Our `:root` cursor is explicitly set to `"default"` so `userSelect: "none"`
    // text always has a default cursor.
    cursor: "default",
});

export const pointerEventsNoneNotInheritedClassName = style({
    pointerEvents: "none",
});

const pointerEventsNoneSprinklesNotSelector = sprinkles({pointerEvents: "none"})
    .split(" ")
    .map(className => `:not(${className})`)
    .join("");

globalStyle(
    `${pointerEventsNoneNotInheritedClassName} > *:not(${pointerEventsNoneNotInheritedClassName})${pointerEventsNoneSprinklesNotSelector}`,
    {
        pointerEvents: "initial",
    },
);

export const rowTitleInputEmptyContainerClassName = style({});
export const rowTitleInputInitialAppRenderEmptyContainerClassName = style({});

export const rowTitleInputPlaceholderClassName = style({
    display: "none",
});

globalStyle(`${rowTitleInputEmptyContainerClassName} ${rowTitleInputPlaceholderClassName}`, {
    display: "block",
});

globalStyle(
    `${rowTitleInputInitialAppRenderEmptyContainerClassName} ${rowTitleInputPlaceholderClassName}`,
    {display: "block"},
);

export const detailTitleInputEmptyContainerClassName = style({});

export const detailTitleInputPlaceholderClassName = style({
    position: "relative",
    zIndex: 0,
});

globalStyle(
    `${detailTitleInputEmptyContainerClassName} > ${detailTitleInputPlaceholderClassName}::before`,
    {
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
    },
);

export const rowTitleInputOverflowGradientLeftContainerClassName = style({
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

export const rowTitleInputOverflowGradientRightContainerClassName = style({
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

export const taskDateInputTextSegmentClassName = style({});

globalStyle(`${taskDateInputTextSegmentClassName}::selection`, {
    // When a text segment is selected we already apply the selection background
    // color. Don't apply it again with the proper text selection highlight.
    background: "none",
});
