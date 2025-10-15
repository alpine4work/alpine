import {globalStyle, style} from "@vanilla-extract/css";
import {
    colorSchemeVars,
    fontSizes,
    fontStyles,
    inputPlaceholderStyles,
    largeSpacingScaleSelector,
    mediumSpacingScaleSelector,
} from "~/client/styles/core/styles_core.js";
import {
    docClassName,
    paragraphLineHeightPx,
    paragraphMargin,
} from "~/client/styles/other/internal/content.css.js";
import {containerClassName} from "~/client/styles/other/internal/content_editor.css.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";

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

export const rowTitleInputPlaceholderClassName = style({
    display: "none",
});

globalStyle(`${rowTitleInputEmptyContainerClassName} ${rowTitleInputPlaceholderClassName}`, {
    display: "block",
});

export const rowTitleInputIsNotEditableClassName = style({});

// Make sure we have higher CSS precedence than
// `sprinkles({userSelect: "text"})`.
globalStyle(`${rowTitleInputIsNotEditableClassName}${rowTitleInputIsNotEditableClassName}`, {
    userSelect: "text",
    cursor: "auto",
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

export const rowTitleInputSingleLineOverflowGradientMarginX = "1.5";

export const rowTitleInputSingleLineOverflowGradientContainerClassName = style({
    marginLeft: `-${spacing[rowTitleInputSingleLineOverflowGradientMarginX]}`,
    marginRight: `-${spacing[rowTitleInputSingleLineOverflowGradientMarginX]}`,
    selectors: {
        [`:not(${rowTitleInputEmptyContainerClassName}) > &::before`]: {
            pointerEvents: "none",
            content: '""',
            position: "absolute",
            zIndex: "20",
            top: 1, // Top 1px to avoid overlapping border.
            bottom: 0,
            left: 0,
            width: spacing[rowTitleInputSingleLineOverflowGradientMarginX],
            background: `linear-gradient(to right, ${colorSchemeVars["grey-0"]}, transparent)`,
        },
        [`:not(${rowTitleInputEmptyContainerClassName}) > &::after`]: {
            pointerEvents: "none",
            content: '""',
            position: "absolute",
            zIndex: "20",
            top: 1, // Top 1px to avoid overlapping border.
            bottom: 0,
            right: 0,
            width: spacing[rowTitleInputSingleLineOverflowGradientMarginX],
            background: `linear-gradient(to left, ${colorSchemeVars["grey-0"]}, transparent)`,
        },
    },
});

export const dateInputTextSegmentClassName = style({});

globalStyle(`${dateInputTextSegmentClassName}::selection`, {
    // When a text segment is selected we already apply the selection background
    // color. Don't apply it again with the proper text selection highlight.
    background: "none",
});

export const collectionsInputAddInputClassName = style({});

export const rowNumberCounterName = "task-row-number";

// When server-side rendering, start the counter at 0.
globalStyle(":root", {
    counterReset: rowNumberCounterName,
});

export const rowNumberClassName = style({
    selectors: {
        "&::before": {
            content: `counter(${rowNumberCounterName})`,
            position: "absolute",
            left: 0,
            top: "50%",
            transform: "translateY(-50%)",
            pointerEvents: "none",
            display: "block",
            minWidth: spacing["4"],
            maxWidth: spacing["8"],
            ...fontSizes["25"],
            ...fontStyles["truncate"],
            letterSpacing: "-0.1ch",
            // The right-most digits are most significant. Truncate at the start instead of
            // the end.
            direction: "rtl",
            color: colorSchemeVars["grey-20"],
            textAlign: "right",
            fontVariantNumeric: "tabular-nums",
        },
    },
});

export const rowTitleInputMultilineAfterWidth = "32";

export const rowTitleInputMultilineAfterClassName = style({
    selectors: {
        "&::after": {
            content: '""',
            display: "inline-block",
            userSelect: "none",
            pointerEvents: "none",
            width: spacing[rowTitleInputMultilineAfterWidth],
        },
    },
});

export const detailNotesContentEditorMinHeightPx = mapObjectValues(
    paragraphLineHeightPx,
    (paragraphLineHeight, spacingScale) =>
        paragraphLineHeight * 2 + convertRemLengthToPx(paragraphMargin, spacingScale) * 1,
);

export const detailNotesContentEditorClassName = style({
    height: "100%",
    selectors: {
        // We need the `${containerClassName} > ${docClassName}` selectors to make sure
        // we override the `min-height: 100%` set with the same selector.
        [`&, ${containerClassName} > ${docClassName}&`]: {
            minHeight: detailNotesContentEditorMinHeightPx.small,
        },
        [`${mediumSpacingScaleSelector} &, ${mediumSpacingScaleSelector} ${containerClassName} > ${docClassName}&`]:
            {
                minHeight: detailNotesContentEditorMinHeightPx.medium,
            },
        [`${largeSpacingScaleSelector} &, ${largeSpacingScaleSelector} ${containerClassName} > ${docClassName}&`]:
            {
                minHeight: detailNotesContentEditorMinHeightPx.large,
            },
    },
});
