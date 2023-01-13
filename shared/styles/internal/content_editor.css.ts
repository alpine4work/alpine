import {globalStyle, style} from "@vanilla-extract/css";
import {
    headingLevel1ClassName,
    headingLevel2ClassName,
    headingLevel3ClassName,
    linkClassName,
    paragraphClassName,
    titleClassName,
} from "~/shared/styles/internal/content_schema.css";
import {fontSizes} from "~/shared/styles/internal/fonts.css";
import {inputPlaceholderColor} from "~/shared/styles/internal/input_placeholder_color.css";

export const containerClassName = style({
    height: "100%",
    // Create a new z-index stacking context.
    position: "relative",
    zIndex: 0,
});

export const emptyTitleClassName = style({});

globalStyle(`${emptyTitleClassName} > ${titleClassName}[data-placeholder]::before`, {
    // The `/ ""` is screen reader alt text. So screen readers don't read the
    // placeholder content.
    //
    // Not all browsers support that syntax, though (like Safari), so we provide a
    // fallback without the `/ ""`.
    content: ["attr(data-placeholder)", 'attr(data-placeholder) / ""'],
    pointerEvents: "none",
    color: inputPlaceholderColor,
    position: "absolute",
    // Reset the `text-fill-color` set by blobs so that we can see the placeholder.
    // @ts-expect-error
    textFillColor: "initial",
    WebkitTextFillColor: "initial",
    // Make sure placeholder is rendered underneath cursor.
    zIndex: -10,
});

export const emptyBodyClassName = style({});

globalStyle(`${emptyBodyClassName} > ${paragraphClassName}[data-placeholder]::before`, {
    // The `/ ""` is screen reader alt text. So screen readers don't read the
    // placeholder content.
    //
    // Not all browsers support that syntax, though (like Safari), so we provide a
    // fallback without the `/ ""`.
    content: ["attr(data-placeholder)", 'attr(data-placeholder) / ""'],
    pointerEvents: "none",
    color: inputPlaceholderColor,
    position: "absolute",
    // Make sure placeholder is rendered underneath cursor.
    zIndex: -10,
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
 * `font.primary` when using Chrome on MacOS.
 *
 * Frustratingly, the [CSS spec allows user agents to pick a height][1] based
 * on the font.
 *
 * We got this approximation by zooming the browser way in and measuring the
 * height of an inline element with font `font.primary`. It was 24.2px when our
 * font size was 20px. When zoomed out it was 24.5px when the font size was
 * 20px and 19.5px when the font size was 16px. The browser is rounding so the
 * closest approximation is that the height of a `font.primary` inline element
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
    paddingTop: `calc((${fontSizes.body.lineHeight} - ${inlineElementActualHeight}) / 2)`,
    paddingBottom: `calc((${fontSizes.body.lineHeight} - ${inlineElementActualHeight}) / 2)`,
    selectors: {
        [`${titleClassName} &`]: {
            paddingTop: `calc((${fontSizes.heading2.lineHeight} - ${inlineElementActualHeight}) / 2)`,
            paddingBottom: `calc((${fontSizes.heading2.lineHeight} - ${inlineElementActualHeight}) / 2)`,
        },
        [`${headingLevel1ClassName} &`]: {
            paddingTop: `calc((${fontSizes.heading3.lineHeight} - ${inlineElementActualHeight}) / 2)`,
            paddingBottom: `calc((${fontSizes.heading3.lineHeight} - ${inlineElementActualHeight}) / 2)`,
        },
        [`${headingLevel2ClassName} &`]: {
            paddingTop: `calc((${fontSizes.heading4.lineHeight} - ${inlineElementActualHeight}) / 2)`,
            paddingBottom: `calc((${fontSizes.heading4.lineHeight} - ${inlineElementActualHeight}) / 2)`,
        },
        [`${headingLevel3ClassName} &`]: {
            paddingTop: `calc((${fontSizes.heading5.lineHeight} - ${inlineElementActualHeight}) / 2)`,
            paddingBottom: `calc((${fontSizes.heading5.lineHeight} - ${inlineElementActualHeight}) / 2)`,
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
