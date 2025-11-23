import {globalStyle, style} from "@vanilla-extract/css";
import {darkColorSchemeSelector} from "~/client/web/styles/core/styles_core.js";
import {
    checkListItemCheckboxContainerClassName,
    docClassName,
    mentionContainerClassName,
    narrowRouteLayoutDocClassName,
} from "~/client/web/styles/other/internal/content.css.js";
import {
    commentClassName,
    fileClassName,
    highlightClassNameByColor,
    linkClassName,
} from "~/shared/design/core/constant_class_names.js";

// The CSS for setting `min-height: 100%` here is pretty annoying. We set
// `docClassName` to `min-height: 100%` and `containerClassName` to
// `min-height: 100%`. However, the `docClassName` element does not end up
// having `min-height: 100%` of `containerClassName`'s parent which we'd
// expect! Instead `docClassName` has the height of its content. It's probably
// calculating `containerClassName` to have a height of 0px instead of 100%
// of its container.
//
// This StackOverflow question has much discussion of this problem with no good
// solution:
// https://stackoverflow.com/a/8468131/1568890
//
// We need two things:
//
// 1. `docClassName`'s height should be at least 100% of `containerClassName`'s
//    parent
// 2. `containerClassName` should have the height of `docClassName` if
//    `docClassName`'s height is greater than 100% of `containerClassName`'s
//    parent
//
// Most solutions to this problem give one or the other. For instance, the top
// voted question on the StackOverflow answer gives 1 but not 2. Setting
// `min-height: 100%` with nothing else on `containerClassName` and
// `docClassName` gives 2 but not 1.
//
// Our solution is to use flexbox which appears to work. Setting `docClassName`
// to `flex-grow: 1` gets `docClassName` to grow when its height is less than
// 100% of `containerClassName`'s parent. The best answer on the StackOverflow
// question does something similar but with `display: table`.
//
// `containerClassName` may also be nested in another `containerClassName` if
// necessary. Useful if you need another wrapper element for some reason (like
// in `<DocumentContentEditor>` which needs a `position: relative` wrapper).
export const containerClassName = style({
    position: "relative",
    minHeight: "100%",
    display: "flex",
    flexDirection: "column",
});

globalStyle(`${containerClassName} > ${docClassName}`, {
    minHeight: "100%",
});

export const hasNoEditAccessClassName = style({});

globalStyle(`${containerClassName}:not(${hasNoEditAccessClassName}) > ${docClassName}`, {
    // Always use a text cursor when in an editor. This matters when
    // `contenteditable="false"`. For instance on initial render or on mobile. On
    // mobile `contenteditable="false"` but tapping switches the editor to
    // editable. While typically there's no mouse so no hover state on mobile, in
    // case the user has made the screen tiny (developers, at least, do this often
    // while debugging) let's give them the text cursor affordance.
    cursor: "text",
});

globalStyle(
    `${containerClassName}${hasNoEditAccessClassName} ${checkListItemCheckboxContainerClassName}`,
    {
        cursor: "inherit",
        userSelect: "inherit",
    },
);

globalStyle(
    [
        `${containerClassName} > ${docClassName}`,
        `${containerClassName} > ${containerClassName}`,
    ].join(", "),
    {
        flexGrow: 1,
    },
);

// We use our `<FocusRing>` class for highlighting a selected node.
globalStyle(".ProseMirror-selectednode", {
    outline: "none !important",
});

export const shiftKeyOrAltKeyDownClassName = style({});

// When the shift or alt key is down then clicking on a link will select the
// underlying text instead of opening it as a link. So show a regular text
// cursor instead of a pointer cursor.
globalStyle(`${shiftKeyOrAltKeyDownClassName} a${linkClassName}`, {
    cursor: "inherit",
});

// When the shift or alt key is down then clicking on a mention will select the
// underlying mention instead of opening it as a link. So show a default
// cursor instead of a pointer cursor.
globalStyle(`${shiftKeyOrAltKeyDownClassName} a${mentionContainerClassName}`, {
    cursor: "default",
});

globalStyle(
    `${narrowRouteLayoutDocClassName} ${shiftKeyOrAltKeyDownClassName} ${commentClassName}`,
    {
        cursor: "inherit",
    },
);

// While pressing shift clicking on a file selects it instead of opening the
// file viewer.
globalStyle(`${shiftKeyOrAltKeyDownClassName} ${fileClassName}`, {
    cursor: "default",
});

export const canNotPrimaryInputHoverContainerClassName = style({});

// If we use a dual input modality then when in editing mode links are inert.
// When you click on them you can edit their text instead of navigating to the
// link. Reflect this in the UI by removing their link color. They'll look like
// regular text with an underline.
globalStyle(
    [
        `${canNotPrimaryInputHoverContainerClassName} ${docClassName}[contenteditable=true] ${linkClassName}`,
        // We give highlighted links a different color in dark mode so we need to
        // explicitly target highlights to set `color: inherit`.
        ...Object.values(highlightClassNameByColor).map(
            highlightClassName =>
                `${darkColorSchemeSelector} ${canNotPrimaryInputHoverContainerClassName} ${docClassName}[contenteditable=true] ${linkClassName} ${highlightClassName}`,
        ),
    ].join(", "),
    {
        color: "inherit",
    },
);
