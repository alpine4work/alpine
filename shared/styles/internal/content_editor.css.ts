import {globalStyle, style} from "@vanilla-extract/css";
import {
    headingLevel1ClassName,
    headingLevel1FontSize,
    headingLevel2ClassName,
    headingLevel2FontSize,
    headingLevel3ClassName,
    headingLevel3FontSize,
    linkClassName,
    paragraphFontSize,
    titleClassName,
    titleFontSize,
} from "~/shared/styles/internal/content_schema.css";

export const containerClassName = style({
    height: "100%",
});

export const hideSelectionWhileUnfocusedClassName = style({
    caretColor: "transparent",
});

globalStyle(`${hideSelectionWhileUnfocusedClassName} *::selection`, {background: "transparent"});
globalStyle(`${hideSelectionWhileUnfocusedClassName} *::-moz-selection`, {
    background: "transparent",
});

/**
 * An approximation of the actual height of an inline element with font
 * `font.normal` when using Chrome on MacOS.
 *
 * Frustratingly, the [CSS spec allows user agents to pick a height][1] based
 * on the font.
 *
 * We got this approximation by zooming the browser way in and measuring the
 * height of an inline element with font `font.normal`. It was 24.2px when our
 * font size was 20px. When zoomed out it was 24.5px when the font size was
 * 20px and 19.5px when the font size was 16px. The browser is rounding so the
 * closest approximation is that the height of a `font.normal` inline element
 * is ~121% of the font size (24.2 / 20).
 *
 * We may need to branch this value depending on the browser.
 *
 * [1]: https://www.w3.org/TR/CSS2/visudet.html#inline-non-replaced
 */
const inlineElementActualHeight = `${24 / 20}em`;

/**
 * When applying a background color to some selected text, we want the
 * background to cover the entire line height, not just the size of the inline
 * element as determined by the browser.
 *
 * These styles using padding top/bottom to grow the inline element height to
 * the line height.
 *
 * Tested that this matches the height of the operating system text selection
 * on Chrome for MacOS. Hopefully it works elsewhere?
 */
export const inlineElementPaddingToLineHeightClassName = style({
    paddingTop: `calc((${paragraphFontSize.lineHeight} - ${inlineElementActualHeight}) / 2)`,
    paddingBottom: `calc((${paragraphFontSize.lineHeight} - ${inlineElementActualHeight}) / 2)`,
    selectors: {
        [`${titleClassName} &`]: {
            paddingTop: `calc((${titleFontSize.lineHeight} - ${inlineElementActualHeight}) / 2)`,
            paddingBottom: `calc((${titleFontSize.lineHeight} - ${inlineElementActualHeight}) / 2)`,
        },
        [`${headingLevel1ClassName} &`]: {
            paddingTop: `calc((${headingLevel1FontSize.lineHeight} - ${inlineElementActualHeight}) / 2)`,
            paddingBottom: `calc((${headingLevel1FontSize.lineHeight} - ${inlineElementActualHeight}) / 2)`,
        },
        [`${headingLevel2ClassName} &`]: {
            paddingTop: `calc((${headingLevel2FontSize.lineHeight} - ${inlineElementActualHeight}) / 2)`,
            paddingBottom: `calc((${headingLevel2FontSize.lineHeight} - ${inlineElementActualHeight}) / 2)`,
        },
        [`${headingLevel3ClassName} &`]: {
            paddingTop: `calc((${headingLevel3FontSize.lineHeight} - ${inlineElementActualHeight}) / 2)`,
            paddingBottom: `calc((${headingLevel3FontSize.lineHeight} - ${inlineElementActualHeight}) / 2)`,
        },
    },
});

// We use our `<FocusRing>` class for highlighting a selected node.
globalStyle(".ProseMirror-selectednode", {
    outline: "none !important",
});

export const shiftKeyOrAltKeyDownClassName = style({});

// When the shift or alt key is down then clicking on a link will select the
// underlying text instead of opening it as a link. So show a regular text
// cursor instead of a pointer cursor.
globalStyle(`${shiftKeyOrAltKeyDownClassName} ${linkClassName}`, {
    cursor: "inherit",
});

// TODO(calebmer): I feel like we should have some kind of style here to make
// it clear where the end of the mention is? Or modify the mention logic so we
// are less forgiving of spaces and arrow key movements.
export const inlineMentionInputClassName = style({});
