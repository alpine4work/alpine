import {globalStyle, style} from "@vanilla-extract/css";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css.js";
import {fontSizes, fontStyles} from "~/shared/styles/internal/fonts.css.js";
import {inputPlaceholderStyles} from "~/shared/styles/internal/input_placeholder.css.js";

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

export const rowTitleInputEmptyContainerClassName = style({});
export const rowTitleInputInitialAppRenderEmptyContainerClassName = style({});

export const rowTitleInputPlaceholderClassName = style({
    display: "none",
});

globalStyle(
    [
        `${rowTitleInputEmptyContainerClassName} ${rowTitleInputPlaceholderClassName}`,
        `${rowTitleInputInitialAppRenderEmptyContainerClassName} ${rowTitleInputPlaceholderClassName}`,
    ].join(", "),
    {
        display: "block",
    },
);

export const rowTitleInputIsNotEditableClassName = style({});

// Make sure we have higher CSS precedence than
// `sprinkles({userSelect: "text"})`.
globalStyle(`${rowTitleInputIsNotEditableClassName}${rowTitleInputIsNotEditableClassName}`, {
    userSelect: "none",
    cursor: "text",
});

export const detailTitleInputEmptyContainerClassName = style({});
export const detailTitleInputInitialAppRenderEmptyContainerClassName = style({});

export const detailTitleInputPlaceholderClassName = style({
    position: "relative",
    zIndex: 0,
});

globalStyle(
    [
        `${detailTitleInputEmptyContainerClassName} > ${detailTitleInputPlaceholderClassName}::before`,
        `${detailTitleInputInitialAppRenderEmptyContainerClassName} > ${detailTitleInputPlaceholderClassName}::before`,
    ].join(", "),
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

export const taskCollectionsInputAddInputClassName = style({});

export const rowNumberCounterName = "task-row-number";

// When server-side rendering, start the counter at 0.
globalStyle(":root", {
    counterReset: rowNumberCounterName,
});

export const rowNumberClassName = style({
    selectors: {
        "&::before": {
            counterIncrement: rowNumberCounterName,
            content: `counter(${rowNumberCounterName})`,
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            pointerEvents: "none",
            display: "block",
            minWidth: addRemLengths(spacing["4"], spacing["0.5"]),
            maxWidth: spacing["8"],
            ...fontSizes["50"],
            ...fontStyles["truncate"],
            letterSpacing: "-0.1ch",
            // The right-most digits are most significant. Truncate at the start instead of
            // the end.
            direction: "rtl",
            color: colorSchemeVars["grey-30"],
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
        },
    },
});

export const taskRowTitleInputMultilineAfterWidth = "32";

export const taskRowTitleInputMultilineAfterClassName = style({
    selectors: {
        "&::after": {
            content: '""',
            display: "inline-block",
            userSelect: "none",
            pointerEvents: "none",
            width: spacing[taskRowTitleInputMultilineAfterWidth],
        },
    },
});
