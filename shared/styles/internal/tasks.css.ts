import {globalStyle, style} from "@vanilla-extract/css";
import {addRemLengths, mobilePlatformMediaQuery, spacing} from "~/shared/design/spacing";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css";
import {inputPlaceholderColor} from "~/shared/styles/internal/input_placeholder_color.css";

export const textCursorNotInheritedClassName = style({
    cursor: "text",
});

globalStyle(`${textCursorNotInheritedClassName} > *`, {
    cursor: "initial",
});

export const noPointerEventsNotInheritedClassName = style({
    pointerEvents: "none",
});

globalStyle(`${noPointerEventsNotInheritedClassName} > *`, {
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
    color: inputPlaceholderColor,
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

const assigneeDetailViewFieldLabelDesktopWidth = "3.25rem";
const assigneeDetailViewFieldLabelMobileWidth = "3.2rem";

const statusButtonAndMarginWidth = addRemLengths(spacing["5"], spacing["4"]);

// NOTE(calebmer): Really small detail: Align the left edge of the first field
// in a task detail view with the task title (which is indented by the status
// button). The first field should always be the "Assignee" field so we can
// hardcode the width of that text.
//
// We right align field labels with their values to help scan the values which
// means there's margin on the left of the label. By making the margin left of
// the label consistent with the margin left of the title this whitespace looks
// more intentional and systematic.
export const detailViewFieldWidthClassName = style({
    width: addRemLengths(statusButtonAndMarginWidth, assigneeDetailViewFieldLabelDesktopWidth),
    "@media": {
        [mobilePlatformMediaQuery]: {
            width: addRemLengths(
                statusButtonAndMarginWidth,
                assigneeDetailViewFieldLabelMobileWidth,
            ),
        },
    },
});
