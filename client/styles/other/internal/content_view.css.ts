import {globalStyle, style} from "@vanilla-extract/css";
import {
    colorSchemeVars,
    fontSizes,
    fontStyles,
    largeSpacingScaleSelector,
} from "~/client/styles/core/styles_core.js";
import {
    extraCompactDocClassName,
    extraCompactParagraphFontSize,
    paragraphFontSize,
} from "~/client/styles/other/internal/content.css.js";
import {paragraphClassName} from "~/shared/content/content_styles.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const truncatedHeight = mapObjectValues(
    paragraphFontSize,
    paragraphFontSize => paragraphFontSize.lineHeight,
);

// TODO(calebmer): We should have a playground for truncated text with all our
// styles to make sure it looks right. Consider adding this when creating the
// table and code block styles.
export const truncatedClassName = style({
    height: truncatedHeight.medium,
    overflow: "hidden",
    selectors: {
        [`${largeSpacingScaleSelector} &`]: {
            height: truncatedHeight.large,
        },
    },
});

globalStyle(`${truncatedClassName} ${paragraphClassName}`, {
    height: truncatedHeight.medium,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
});

globalStyle(`${largeSpacingScaleSelector} ${truncatedClassName} ${paragraphClassName}`, {
    height: truncatedHeight.large,
});

export const updatedNoteClassName = style({
    ...fontSizes["50"],
    color: colorSchemeVars["grey-50"],
    cursor: "default",
    // If this is selectable, it messes with `<ContentView>` copy logic.
    userSelect: "none",
});

export const seeButtonClassName = style({
    ...paragraphFontSize.medium,
    ...fontStyles["semi-bold"],
    cursor: "pointer",
    userSelect: "none",
    color: colorSchemeVars["grey-90"],
    selectors: {
        [`${largeSpacingScaleSelector} &`]: {
            ...paragraphFontSize.large,
        },
        [`${extraCompactDocClassName} &`]: {
            ...extraCompactParagraphFontSize,
        },
    },
});

export const seeButtonPressedClassName = style({
    opacity: 0.6,
});
