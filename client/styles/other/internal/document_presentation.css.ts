import {globalStyle, style} from "@vanilla-extract/css";
import {fontSizes} from "~/client/styles/core/styles_core.js";
import {
    docClassName,
    fileImagePreviewContentClassName,
    titleFontSize,
} from "~/client/styles/other/internal/content.css.js";
import {
    linkClassName,
    tableWrapperClassName,
    titleClassName,
} from "~/shared/design/core/constant_class_names.js";

export const slideClassName = style({
    pointerEvents: "none",
});

globalStyle(
    [
        `${slideClassName} ${docClassName}`,
        `${slideClassName} ${fileImagePreviewContentClassName}`,
    ].join(", "),
    {
        // Even though we set `pointer-events: none` we still want to set
        // `user-select: none` so that keyboard shortcuts like cmd-a don't select all
        // the text on the slide.
        userSelect: "none",
    },
);

// Allow clicking links. Anything we allow to be clickable within the
// presentation view we should also make sure is ignored from the "click to
// advance slide" logic in `<DocumentPresentationView>` (look for the
// `ignorePressFromElement()` function).
globalStyle(`${slideClassName} ${linkClassName}`, {
    pointerEvents: "auto",
});

// `${slideClassName}` sets `pointer-events: none` but
// `${tableWrapperClassName} table` sets `pointer-events: auto` which overrides
// `pointer-events: none`. We want the table to be scrollable so allow
// `pointer-events: auto` on the `table` element but for all its direct
// children set `pointer-events: none` (see the CSS below).
globalStyle(`${slideClassName} ${tableWrapperClassName} table`, {
    pointerEvents: "auto",
});

globalStyle(`${slideClassName} ${tableWrapperClassName} table > *`, {
    pointerEvents: "none",
});

// Increase specificity by listing `slideClassName` 3 times so we can beat
// other styles that add `paddingTop` to `titleClassName`.
globalStyle(`${slideClassName}${slideClassName}${slideClassName} ${titleClassName}`, {
    minHeight: fontSizes[titleFontSize.wide].lineHeight,
    paddingTop: "initial",
});
