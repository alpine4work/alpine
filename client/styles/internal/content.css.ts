import {assignVars, createGlobalTheme, createVar, globalStyle, style} from "@vanilla-extract/css";
import Color from "color";
import {borderRadius} from "~/client/styles/internal/border_radius.css.js";
import {buttonPressedOverlayOpacity} from "~/client/styles/internal/button.css.js";
import {
    accentThemeBackgroundColor,
    accentThemeForegroundColor,
    colorSchemeVars,
    darkColorSchemeSelector,
    lightColorSchemeSelector,
} from "~/client/styles/internal/color_scheme.css.js";
import {
    backgroundFontSizePercentage,
    emojiFontFamily,
    fontSizes,
    fontStyles,
} from "~/client/styles/internal/fonts.css.js";
import {
    extrapolateHighlightColor,
    extrapolateHighlightRawColorWithoutBounds,
} from "~/client/styles/internal/helpers/extrapolate_highlight_color.js";
import {
    RawColor,
    parseRawColor,
    printRawColor,
} from "~/client/styles/internal/helpers/raw_color.js";
import {inputPlaceholderStyles} from "~/client/styles/internal/input_placeholder.css.js";
import {
    desktopNavigationBarHeight,
    mobileNavigationBarHeight,
} from "~/client/styles/internal/navigation_bar.css.js";
import {
    desktopPlatformSelector,
    mobilePlatformSelector,
} from "~/client/styles/internal/platform.css.js";
import {backgroundColorVar} from "~/client/styles/internal/sprinkles.css.js";
import * as sharedClassNames from "~/shared/content/content_styles.js";
import {colors} from "~/shared/design/colors.js";
import {colorByHighlightColor} from "~/shared/design/highlight_color.js";
import {invertedColorsWithShade} from "~/shared/design/inverted_colors.js";
import {
    RemLength,
    addRemLengths,
    parseRemLengthNumber,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/spacing.js";
import {themeColors} from "~/shared/design/theme_colors.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {lerp} from "~/shared/helpers/number/lerp.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";

const boldClassName = `.${sharedClassNames.boldClassName}`;
const unorderedListItemClassName = `.${sharedClassNames.unorderedListItemClassName}`;
const checkListItemCheckedClassName = `.${sharedClassNames.checkListItemCheckedClassName}`;
const codeBlockClassName = `.${sharedClassNames.codeBlockClassName}`;
const codeBlockLineClassName = `.${sharedClassNames.codeBlockLineClassName}`;
const codeBlockLineContentClassName = `.${sharedClassNames.codeBlockLineContentClassName}`;
const codeBlockWrapperClassName = `.${sharedClassNames.codeBlockWrapperClassName}`;
const codeClassName = `.${sharedClassNames.codeClassName}`;
const commentClassName = `.${sharedClassNames.commentClassName}`;
const dividerClassName = `.${sharedClassNames.dividerClassName}`;
const headingLevel1ClassName = `.${sharedClassNames.headingLevel1ClassName}`;
const headingLevel2ClassName = `.${sharedClassNames.headingLevel2ClassName}`;
const headingLevel3ClassName = `.${sharedClassNames.headingLevel3ClassName}`;
const italicClassName = `.${sharedClassNames.italicClassName}`;
const linkClassName = `.${sharedClassNames.linkClassName}`;
const listItemClassName = `.${sharedClassNames.listItemClassName}`;
const listItemIndentationVar = sharedClassNames.listItemIndentationVar;
const orderedListItemClassName = `.${sharedClassNames.orderedListItemClassName}`;
const paragraphClassName = `.${sharedClassNames.paragraphClassName}`;
const quoteBlockClassName = `.${sharedClassNames.quoteBlockClassName}`;
const strikeClassName = `.${sharedClassNames.strikeClassName}`;
const titleClassName = `.${sharedClassNames.titleClassName}`;
const fileRowClassName = `.${sharedClassNames.fileRowClassName}`;
const fileFloatClassName = `.${sharedClassNames.fileFloatClassName}`;
const fileFloatLeftClassName = `.${sharedClassNames.fileFloatLeftClassName}`;
const fileFloatRightClassName = `.${sharedClassNames.fileFloatRightClassName}`;
const fileClassName = `.${sharedClassNames.fileClassName}`;

const highlightClassNameByColor = mapObjectValues(
    sharedClassNames.highlightClassNameByColor,
    className => `.${className}`,
);

// TODO(calebmer): Running list of style tweaks to explore.
//
// - Link underline is too close to the link
// - Link dark mode color too dark (light mode color feels right?)
// - Blobs still a little too overpowering of content
// - Blobs that are just on the cusp of merging or not merging look weird to me? idk
// - Pressing a link should change the style of the link somehow as feedback.
//   At least on mobile
// - When there is a spellcheck squiggle on a link with an underline, the
//   underline disappears.
// - Strikethrough on h1 feels too thin relative to text
// - On mobile, does hitting enter to create a new line capitalize? With
//   auto-capitalization on and off.
// - Bold labels in dark mode don't have enough contrast? See
//   https://cyberworlds.dev/s/111hc413nfdxa6vwspnhm3ejsc/documents/wshttcjr5egq22e11k92tq1z7m
// - Documents feel like they need a tighter width and more whitespace (more
//   line height + more space between paragraphs). Thinking about this while
//   writing:
//   https://cyberworlds.dev/s/111hc413nfdxa6vwspnhm3ejsc/documents/r0jzswspqf11nmy1g0zh3n6y4r

// We've optimized file preview image resize widths (see
// `getFilePreviewImageResizeWidth()`) to align with our content max width.
// Specifically we depend on `blockMaxWidth` being 600px on desktop. If you
// adjust this value, consider also adjusting file preview image resize widths.
const contentMaxWidthSpacing = "160";
export {contentMaxWidthSpacing as contentMaxWidth};
const contentMaxWidth = spacing[contentMaxWidthSpacing];

export const blockMaxWidth = mapObjectValues(screenPaddingX, screenPaddingX =>
    subtractRemLengths(contentMaxWidth, spacing[screenPaddingX], spacing[screenPaddingX]),
);
export const blockMaxWidthRem = mapObjectValues(blockMaxWidth, blockMaxWidth =>
    parseRemLengthNumber(blockMaxWidth),
);

const defaultParagraphMarginSpacing = "2";
const defaultParagraphMargin = spacing[defaultParagraphMarginSpacing];
export {defaultParagraphMarginSpacing as defaultParagraphMargin};
export const defaultParagraphMarginRem = parseRemLengthNumber(defaultParagraphMargin);

const blockMaxWidthVar = createVar("block-max-width");
const paragraphMarginVar = createVar("paragraph-margin");
const standaloneBlockMarginVar = createVar("standalone-block-margin");
const listItemOffsetVar = createVar("list-item-offset");

globalStyle(":root", {
    vars: {
        [blockMaxWidthVar]: blockMaxWidth.desktop,
        [paragraphMarginVar]: defaultParagraphMargin,
        [standaloneBlockMarginVar]: spacing["4"],
        [listItemOffsetVar]: spacing["0"],
    },
});

globalStyle(mobilePlatformSelector, {
    vars: {
        [blockMaxWidthVar]: blockMaxWidth.mobile,
    },
});

export const docClassName = style({
    minHeight: "100%",
    color: colorSchemeVars["grey-100"],
    caretColor: colorSchemeVars["grey-100"],
    // Create a new z-index stacking context.
    position: "relative",
    zIndex: 0,
    userSelect: "text",
    cursor: "auto",
    // Apply the same [CSS styles on the `ProseMirror` class][1] to all content.
    // That way when we render content in read-only mode it appears the same as if
    // we rendered it in an editor.
    //
    // [1]: https://github.com/ProseMirror/prosemirror-view/blob/67a87c2e63fdc085233162df7e9eada643afd070/style/prosemirror.css#L6-L11
    wordWrap: "break-word",
    whiteSpace: ["pre-wrap", "break-spaces"],
    WebkitFontVariantLigatures: "none",
    fontVariantLigatures: "none",
    fontFeatureSettings: '"liga" 0',
});

export const withMobileLayoutDocClassName = style({});

export const selectionChangeDraggingClassName = style({});

const compactListItemOffsetSpacing = "2";
const compactListItemOffset = spacing[compactListItemOffsetSpacing];
export {compactListItemOffsetSpacing as compactListItemOffset};

export const compactDocClassName = style({
    vars: {
        // Slightly smaller paragraph margins in messages. This makes bullet points in
        // a message bubble look better.
        [paragraphMarginVar]: spacing["1.5"],
        [standaloneBlockMarginVar]: spacing["3"],
        // Pull in list items so they're not so far from the edge of the message
        // bubble.
        [listItemOffsetVar]: `-${compactListItemOffset}`,
    },
});

export const extraCompactDocClassName = style({
    selectors: {
        // Double selector so we override `compactDocClassName`.
        "&&": {
            vars: {
                // Slightly smaller paragraph margins in messages. This makes bullet points in
                // a message bubble look better.
                [paragraphMarginVar]: spacing["1"],
            },
        },
    },
});

const blockStyles = {
    width: "100%",
    maxWidth: blockMaxWidthVar,
    marginLeft: "auto",
    marginRight: "auto",
    // By default, all blocks are rendered below `fileFloat`. If you want your
    // block to be rendered besides `fileFloat` you must explicitly omit this
    // `clear` property.
    clear: "both",
} as const;

export const paragraphFontSize: {
    fontSize: string;
    letterSpacing: string;
    lineHeight: RemLength;
} = {
    ...fontSizes["100"],
    lineHeight: "1.375rem",
};

export const paragraphLineHeightRem = parseRemLengthNumber(paragraphFontSize.lineHeight);

export const extraCompactParagraphFontSize: {
    fontSize: string;
    letterSpacing: string;
    lineHeight: RemLength;
} = {
    ...fontSizes["100-extra-compact"],
    // Extra compact font size has less relative line height compared to regular
    // font size.
    lineHeight: "1.175rem",
};

globalStyle(paragraphClassName, {
    ...omitObject(blockStyles, ["clear"]),
    ...fontStyles.normal,
    ...paragraphFontSize,
    // Make sure this node always takes up space even if it is empty. Important
    // when we are rendering placeholders in `<ContentView>`.
    minHeight: paragraphFontSize.lineHeight,
    marginTop: paragraphMarginVar,
    marginBottom: paragraphMarginVar,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

globalStyle(`${extraCompactDocClassName} ${paragraphClassName}`, {
    ...extraCompactParagraphFontSize,
    minHeight: extraCompactParagraphFontSize.lineHeight,
});

// Header sizes are smaller on mobile than desktop because mobile has less
// horizontal space than desktop. So we want to fit more header on a
// single line.
export const desktopTitleFontSize = fontSizes["800"];
export const mobileTitleFontSize = fontSizes["700"];

export const desktopHeadingLevel1FontSize = fontSizes["600"];
export const mobileHeadingLevel1FontSize = fontSizes["500"];

export const desktopHeadingLevel2FontSize = fontSizes["400"];
export const mobileHeadingLevel2FontSize = fontSizes["mobile-heading-350"];

export const desktopHeadingLevel3FontSize = fontSizes["200"];
export const mobileHeadingLevel3FontSize = fontSizes["200"];

export const desktopHeading1TopMargin = "10";
export const mobileHeading1TopMargin = "8";

export const desktopHeading2TopMargin = "8";
export const mobileHeading2TopMargin = "6";

export const desktopHeading3TopMargin = "6";
export const mobileHeading3TopMargin = "5";

export const desktopHeading4TopMargin = "4";
export const mobileHeading4TopMargin = "4";

const headingMarginVars = createGlobalTheme(":root", {
    heading1TopMargin: spacing[desktopHeading1TopMargin],
    heading2TopMargin: spacing[desktopHeading2TopMargin],
    heading3TopMargin: spacing[desktopHeading3TopMargin],
    heading4TopMargin: spacing[desktopHeading4TopMargin],
});

globalStyle(withMobileLayoutDocClassName, {
    vars: assignVars(headingMarginVars, {
        heading1TopMargin: spacing[mobileHeading1TopMargin],
        heading2TopMargin: spacing[mobileHeading2TopMargin],
        heading3TopMargin: spacing[mobileHeading3TopMargin],
        heading4TopMargin: spacing[mobileHeading4TopMargin],
    }),
});

globalStyle(mobilePlatformSelector, {
    vars: assignVars(headingMarginVars, {
        heading1TopMargin: spacing[mobileHeading1TopMargin],
        heading2TopMargin: spacing[mobileHeading2TopMargin],
        heading3TopMargin: spacing[mobileHeading3TopMargin],
        heading4TopMargin: spacing[mobileHeading4TopMargin],
    }),
});

export const desktopTitlePaddingTop = addRemLengths(
    spacing["10"],
    spacing[desktopNavigationBarHeight],
);
export const mobilePlatformTitlePaddingTop = addRemLengths(
    spacing["3"],
    spacing[mobileNavigationBarHeight],
);
export const mobileLayoutTitlePaddingTop = addRemLengths(
    spacing["3"],
    spacing[desktopNavigationBarHeight],
);

const titleLetterSpacingFactor = 0.6;

globalStyle(titleClassName, {
    ...blockStyles,
    ...fontStyles["bold"],
    ...desktopTitleFontSize,
    // Use a bolder font weight for titles than `bold` but `extra-bold` is too
    // much. Find something visually pleasing between that which helps titles
    // really stand out.
    fontWeight: 650,
    // The letter spacing is too tight for bold text at this font size. Ease up
    // a bit on the letter spacing.
    letterSpacing: `calc(${desktopTitleFontSize.letterSpacing} * ${titleLetterSpacingFactor})`,
    paddingTop: `calc(${desktopTitlePaddingTop} + var(--safe-area-inset-top, 0px))`,
    // Make sure this node always takes up space even if it is empty. Important
    // when we are rendering placeholders in `<ContentView>`.
    minHeight: `calc(${desktopTitleFontSize.lineHeight} + ${desktopTitlePaddingTop})`,
    marginBottom: paragraphMarginVar,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

globalStyle(`${withMobileLayoutDocClassName} ${titleClassName}`, {
    ...mobileTitleFontSize,
    letterSpacing: `calc(${mobileTitleFontSize.letterSpacing} * ${titleLetterSpacingFactor})`,
    paddingTop: `calc(${mobileLayoutTitlePaddingTop} + var(--safe-area-inset-top, 0px))`,
    minHeight: `calc(${mobileTitleFontSize.lineHeight} + ${mobileLayoutTitlePaddingTop})`,
});

globalStyle(
    [
        `${mobilePlatformSelector} ${titleClassName}`,
        `${mobilePlatformSelector} ${withMobileLayoutDocClassName} ${titleClassName}`,
    ].join(", "),
    {
        ...mobileTitleFontSize,
        paddingTop: `calc(${mobilePlatformTitlePaddingTop} + var(--safe-area-inset-top, 0px))`,
        minHeight: `calc(${mobileTitleFontSize.lineHeight} + ${mobilePlatformTitlePaddingTop})`,
    },
);

globalStyle(headingLevel1ClassName, {
    ...blockStyles,
    ...fontStyles["bold"],
    ...desktopHeadingLevel1FontSize,
    marginTop: headingMarginVars.heading1TopMargin,
    marginBottom: paragraphMarginVar,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

globalStyle(`${mobilePlatformSelector} ${headingLevel1ClassName}`, {
    ...mobileHeadingLevel1FontSize,
});
globalStyle(`${withMobileLayoutDocClassName} ${headingLevel1ClassName}`, {
    ...mobileHeadingLevel1FontSize,
});
globalStyle(`${titleClassName} + ${headingLevel1ClassName}`, {
    marginTop: headingMarginVars.heading4TopMargin,
});

globalStyle(headingLevel2ClassName, {
    ...blockStyles,
    ...fontStyles["bold"],
    ...desktopHeadingLevel2FontSize,
    marginTop: headingMarginVars.heading2TopMargin,
    marginBottom: paragraphMarginVar,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

globalStyle(`${mobilePlatformSelector} ${headingLevel2ClassName}`, {
    ...mobileHeadingLevel2FontSize,
});
globalStyle(`${withMobileLayoutDocClassName} ${headingLevel2ClassName}`, {
    ...mobileHeadingLevel2FontSize,
});
globalStyle(`${titleClassName} + ${headingLevel2ClassName}`, {
    marginTop: headingMarginVars.heading4TopMargin,
});
globalStyle(`${headingLevel1ClassName} + ${headingLevel2ClassName}`, {
    marginTop: headingMarginVars.heading4TopMargin,
});

globalStyle(headingLevel3ClassName, {
    ...blockStyles,
    ...fontStyles["bold"],
    ...desktopHeadingLevel3FontSize,
    marginTop: headingMarginVars.heading3TopMargin,
    marginBottom: paragraphMarginVar,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

globalStyle(`${mobilePlatformSelector} ${headingLevel3ClassName}`, {
    ...mobileHeadingLevel3FontSize,
});
globalStyle(`${withMobileLayoutDocClassName} ${headingLevel3ClassName}`, {
    ...mobileHeadingLevel3FontSize,
});
globalStyle(`${titleClassName} + ${headingLevel3ClassName}`, {
    marginTop: headingMarginVars.heading4TopMargin,
});
globalStyle(`${headingLevel1ClassName} + ${headingLevel3ClassName}`, {
    marginTop: headingMarginVars.heading4TopMargin,
});
globalStyle(`${headingLevel2ClassName} + ${headingLevel3ClassName}`, {
    marginTop: headingMarginVars.heading4TopMargin,
});

const quoteBlockIndentation = spacing["4"];
const quoteBlockBorderWidth = "0.1875rem";

globalStyle(quoteBlockClassName, {
    ...omitObject(blockStyles, ["clear"]),
    position: "relative",
    paddingLeft: quoteBlockIndentation,
    marginTop: standaloneBlockMarginVar,
    marginBottom: standaloneBlockMarginVar,
    color: colorSchemeVars["grey-60"],
    caretColor: colorSchemeVars["grey-60"],
});

globalStyle(`${quoteBlockClassName}::before`, {
    content: '""',
    position: "absolute",
    top: "0",
    bottom: "0",
    left: "0",
    width: quoteBlockBorderWidth,
    backgroundColor: colorSchemeVars["grey-10"],
    pointerEvents: "none",
});

// NOTE(calebmer): Ordered lists and bullet lists use the same style for all
// levels of indentation. For example, we don't switch to letters or roman
// numerals for ordered lists.
//
// I think you end up with more polished looking docs this way. The indentation
// is enough variation to distinguish levels, a separate affordance is
// redundant.
//
// In the ordered list case, numbers are easier to understand than letters or
// roman numerals.

const listItemIndentationSpacing = "8";
const listItemIndentation = spacing[listItemIndentationSpacing];
export {listItemIndentationSpacing as listItemIndentation};
export const listItemIndentationRem = parseRemLengthNumber(listItemIndentation);

const unorderedListItemBulletSizeSpacing = "1.5";
const unorderedListItemBulletSize = spacing[unorderedListItemBulletSizeSpacing];
export {unorderedListItemBulletSizeSpacing as unorderedListItemBulletSize};

globalStyle(listItemClassName, {
    ...omitObject(blockStyles, ["clear"]),
    position: "relative",
    paddingLeft: `calc((${listItemIndentationVar} + 1) * ${listItemIndentation} + ${listItemOffsetVar})`,
});

export const unorderedListItemBulletTop: RemLength = `${
    parseRemLengthNumber(
        subtractRemLengths(paragraphFontSize.lineHeight, unorderedListItemBulletSize),
    ) / 2
}rem`;

const extraCompactUnorderedListItemBulletTop: RemLength = `${
    parseRemLengthNumber(
        subtractRemLengths(extraCompactParagraphFontSize.lineHeight, unorderedListItemBulletSize),
    ) / 2
}rem`;

export const unorderedListItemBulletLeft = `calc((${listItemIndentationVar} * ${listItemIndentation}) + ${
    parseRemLengthNumber(listItemIndentation) / 2 -
    parseRemLengthNumber(unorderedListItemBulletSize) / 2
}rem + ${listItemOffsetVar})`;

globalStyle(`${unorderedListItemClassName}::before`, {
    content: '""',
    position: "absolute",
    backgroundColor: "currentColor",
    borderRadius: "50%",
    pointerEvents: "none",
    width: unorderedListItemBulletSize,
    height: unorderedListItemBulletSize,
    top: unorderedListItemBulletTop,
    left: unorderedListItemBulletLeft,
});

globalStyle(`${extraCompactDocClassName} ${unorderedListItemClassName}::before`, {
    top: extraCompactUnorderedListItemBulletTop,
});

globalStyle(`${orderedListItemClassName}::before`, {
    content: 'attr(data-list-number) "."',
    position: "absolute",
    pointerEvents: "none",
    top: 0,
    left: `calc((${listItemIndentationVar} * ${listItemIndentation}) + ${spacing["6"]} + ${listItemOffsetVar})`,
    textAlign: "right",
    transform: "translateX(-100%)",
    ...paragraphFontSize,
    fontVariantNumeric: "tabular-nums",
});

globalStyle(`${extraCompactDocClassName} ${orderedListItemClassName}::before`, {
    ...extraCompactParagraphFontSize,
});

const checkListItemCheckboxDesktopSize = "4";
const checkListItemCheckboxMobileSize = "5";

globalStyle(checkListItemCheckedClassName, {
    color: colorSchemeVars["grey-60"],
    caretColor: colorSchemeVars["grey-60"],
});

export const checkListItemContentClassName = style({});

// The checkbox is a little small. Add some extra hit area to make it easier
// to click.
export const checkListItemCheckboxContainerClassName = style({
    position: "absolute",
    top: `${
        (parseRemLengthNumber(paragraphFontSize.lineHeight) -
            parseRemLengthNumber(spacing[checkListItemCheckboxDesktopSize])) /
        2
    }rem`,
    left: `calc((${listItemIndentationVar} * ${listItemIndentation}) + ${
        parseRemLengthNumber(listItemIndentation) / 2 -
        (parseRemLengthNumber(spacing[checkListItemCheckboxDesktopSize]) +
            parseRemLengthNumber(spacing["1"]) * 2) /
            2
    }rem + ${listItemOffsetVar})`,
    borderRadius: "100%",
    paddingLeft: spacing["1"],
    paddingRight: spacing["1"],
    cursor: "default",
    userSelect: "none",
    selectors: {
        [`${mobilePlatformSelector} &`]: {
            top: `${
                (parseRemLengthNumber(paragraphFontSize.lineHeight) -
                    parseRemLengthNumber(spacing[checkListItemCheckboxMobileSize])) /
                2
            }rem`,
            left: `calc((${listItemIndentationVar} * ${listItemIndentation}) + ${
                parseRemLengthNumber(listItemIndentation) / 2 -
                (parseRemLengthNumber(spacing[checkListItemCheckboxMobileSize]) +
                    parseRemLengthNumber(spacing["1"]) * 2) /
                    2
            }rem + ${listItemOffsetVar})`,
        },
        [`${desktopPlatformSelector} ${extraCompactDocClassName} &`]: {
            top: `${
                (parseRemLengthNumber(extraCompactParagraphFontSize.lineHeight) -
                    parseRemLengthNumber(spacing[checkListItemCheckboxDesktopSize])) /
                2
            }rem`,
        },
        [`${mobilePlatformSelector} ${extraCompactDocClassName} &`]: {
            top: `${
                (parseRemLengthNumber(extraCompactParagraphFontSize.lineHeight) -
                    parseRemLengthNumber(spacing[checkListItemCheckboxMobileSize])) /
                2
            }rem`,
        },
    },
});

// TODO(calebmer): We also need a disabled style for this checkbox when the
// checkbox is read-only.
export const checkListItemCheckboxClassName = style({
    position: "relative",
    overflow: "hidden",
    borderRadius: "100%",
    width: spacing[checkListItemCheckboxDesktopSize],
    height: spacing[checkListItemCheckboxDesktopSize],
    backgroundColor: "transparent",
    color: "transparent",
    borderWidth: 1,
    borderColor: colorSchemeVars["grey-40"],
    selectors: {
        [`${lightColorSchemeSelector} ${checkListItemCheckedClassName} &`]: {
            backgroundColor: colorSchemeVars[accentThemeBackgroundColor.light],
            color: colorSchemeVars[accentThemeForegroundColor],
            borderWidth: 0,
        },
        [`${darkColorSchemeSelector} ${checkListItemCheckedClassName} &`]: {
            backgroundColor: colorSchemeVars[accentThemeBackgroundColor.dark],
            color: colorSchemeVars[accentThemeForegroundColor],
            borderWidth: 0,
        },
        [`${mobilePlatformSelector} &`]: {
            width: spacing[checkListItemCheckboxMobileSize],
            height: spacing[checkListItemCheckboxMobileSize],
        },
    },
});

export const checkListItemCheckboxPressedClassName = style({
    backgroundColor: colorSchemeVars["grey-10"],
    selectors: {
        [`${lightColorSchemeSelector} ${checkListItemCheckedClassName} &`]: {
            backgroundColor: colorSchemeVars[accentThemeBackgroundColor.light],
        },
        [`${darkColorSchemeSelector} ${checkListItemCheckedClassName} &`]: {
            backgroundColor: colorSchemeVars[accentThemeBackgroundColor.dark],
        },
        [`${checkListItemCheckedClassName} &::before`]: {
            content: '""',
            position: "absolute",
            inset: 0,
            backgroundColor: colorSchemeVars["grey-100-const"],
            opacity: buttonPressedOverlayOpacity,
        },
    },
});

export const checkListItemCheckboxIconClassName = style({
    position: "absolute",
    top: "50%",
    left: "50%",
    width: addRemLengths(spacing["2"], spacing["0.5"]),
    height: addRemLengths(spacing["2"], spacing["0.5"]),
    transform: `translate(-50%, -50%) scale(${parseInt(checkListItemCheckboxDesktopSize, 10) / 4})`,
    pointerEvents: "none",
    selectors: {
        [`${mobilePlatformSelector} &`]: {
            transform: `translate(-50%, -50%) scale(${
                parseInt(checkListItemCheckboxMobileSize, 10) / 4
            })`,
        },
    },
});

const codeBlockToolbarHeightSpacing = "6";
const codeBlockToolbarHeight = spacing[codeBlockToolbarHeightSpacing];
export {codeBlockToolbarHeightSpacing as codeBlockToolbarHeight};

const mobileCodeBlockToolbarMaxWidth = spacing["32"];
const desktopCodeBlockToolbarMaxWidth = addRemLengths(
    mobileCodeBlockToolbarMaxWidth,
    codeBlockToolbarHeight,
);

const codeBlockPaddingRightSpacing = "3";
const codeBlockPaddingRight = spacing[codeBlockPaddingRightSpacing];
export {codeBlockPaddingRightSpacing as codeBlockPaddingRight};

globalStyle(codeBlockWrapperClassName, {
    ...blockStyles,
    position: "relative",
    zIndex: "0",
    overflowX: "auto",
    overscrollBehaviorX: "contain",
    marginTop: standaloneBlockMarginVar,
    marginBottom: standaloneBlockMarginVar,
    counterReset: "code-block-line-number",
    ...paragraphFontSize,
    // `fontStyles.code` needs to be second to override `letter-spacing`.
    ...fontStyles.code,
});

// If the code block toolbar is a little taller than a line of code (it is)
// then we need to add some padding Y to our code block so the toolbar can be
// centered relative to the first line of text when the toolbar is positioned
// with `position: absolute; top: 0`. We can't position the toolbar with a
// negative `top` since then it would be clipped because `overflowY` is hidden
// (since `overflowX` is scrollable).
const codeBlockPaddingY = `${Math.max(
    0,
    (parseRemLengthNumber(codeBlockToolbarHeight) -
        parseRemLengthNumber(paragraphFontSize.lineHeight)) /
        2,
)}rem`;

const extraCompactCodeBlockPaddingY = `${Math.max(
    0,
    (parseRemLengthNumber(codeBlockToolbarHeight) -
        parseRemLengthNumber(extraCompactParagraphFontSize.lineHeight)) /
        2,
)}rem`;

globalStyle(codeBlockClassName, {
    display: "block",
    position: "relative",
    // Render under toolbar. Toolbar needs to be at `z-index: 0` so native
    // scrollbar renders on top of it.
    zIndex: "-10",
    width: "fit-content",
    ...paragraphFontSize,
    // `fontStyles.code` needs to be second to override `letter-spacing`.
    ...fontStyles.code,
    paddingTop: codeBlockPaddingY,
    paddingBottom: codeBlockPaddingY,
});

// The reason use a triple selector is to beat the CSS set by ProseMirror since
// ProseMirror automatically sets white space to pre-wrap.
globalStyle(`${codeBlockClassName}${codeBlockClassName}${codeBlockClassName}`, {
    whiteSpace: "pre",
});

globalStyle(`${extraCompactDocClassName} ${codeBlockClassName}`, {
    ...extraCompactParagraphFontSize,
    paddingTop: extraCompactCodeBlockPaddingY,
    paddingBottom: extraCompactCodeBlockPaddingY,
});

// In Safari, when the user is scrolling and they reach the end of the scroll
// view they may start overscrolling. When the user ends their scroll Safari
// will bounce animate the scroll position back to the correct range.
//
// So for example if a user is at scroll offset 100 and is scrolling left they
// may reach 0 then overscroll to -10. When they release their scroll it
// bounces back to 0 since -10 is not a valid scroll offset.
//
// We want our sticky elements to stay "stuck" while the user is overscrolling
// instead of moving with the scroll view. So to accomplish this we have some
// slop to modify the true position of sticky elements. We place the sticky
// elements far offscreen and let `position: sticky` move them onscreen. If a
// left positioned sticky element is originally placed at position -200 then
// when the view is scrolled to position -10 the sticky element will still be
// stuck to the left edge of the view. However, if a left positioned sticky
// element is originally at position 0 then when the view is scroll to position
// -10 it'll unstick and move with the scroll.
//
// To debug this try opening Safari (desktop or mobile will work) and set this
// to 0. Then try overscrolling a code block left and right and observe how the
// line numbers and toolbar move with the overscroll.
//
// Technically, if the user overscrolls to this slop sticky elements will
// unstick and start traveling with the scroll but a user has to try really
// hard to overscroll this far since the operating system will resist the
// overscroll.
const codeBlockLineOverscrollSlopX = spacing["96"];

globalStyle(codeBlockLineClassName, {
    display: "flex",
    width: "100%",
    counterIncrement: "code-block-line-number",
});

globalStyle(`${codeBlockLineClassName}::before`, {
    content: "counter(code-block-line-number)",
    flexShrink: "0",
    pointerEvents: "none",
    zIndex: "0",
    position: "sticky",
    left: "0",
    marginLeft: `-${codeBlockLineOverscrollSlopX}`,
    width: `calc(${listItemIndentation} + ${listItemOffsetVar})`,
    // Optically align code block numbers with ordered list item numbers.
    paddingRight: "0.75rem",
    textAlign: "right",
    color: colorSchemeVars["grey-30"],
    // No gradient for the line number. We have a hard border to create the
    // illusion of the line number column sliding over the code.
    backgroundColor: backgroundColorVar,
    ...fontStyles["code-light"],
});

globalStyle(`${codeBlockLineClassName}::after`, {
    content: '""',
    flexShrink: "0",
    pointerEvents: "none",
    zIndex: "0",
    position: "sticky",
    right: "0",
    width: codeBlockPaddingRight,
    height: paragraphFontSize.lineHeight,
    background: `linear-gradient(to left, ${backgroundColorVar}, transparent)`,
});

globalStyle(
    `${desktopPlatformSelector} ${codeBlockClassName} > ${codeBlockLineClassName}:first-child`,
    {
        paddingRight: desktopCodeBlockToolbarMaxWidth,
    },
);

globalStyle(
    `${mobilePlatformSelector} ${codeBlockClassName} > ${codeBlockLineClassName}:first-child`,
    {
        paddingRight: mobileCodeBlockToolbarMaxWidth,
    },
);

globalStyle(`${codeBlockClassName} > ${codeBlockLineClassName}:first-child::after`, {
    content: "none",
});

globalStyle(codeBlockLineContentClassName, {
    position: "relative",
    // Render under line number. Line number needs to be at `z-index: 0` so native
    // scrollbar renders on top of it.
    zIndex: "-10",
    paddingLeft: codeBlockLineOverscrollSlopX,
    flexGrow: "1",
    // `min-width` and `min-height` for when the code block line is empty. We still
    // need space to render the cursor (must be more than our `paddingLeft`) and we
    // can't collapse the line (can't be 0 height).
    minWidth: `calc(${codeBlockLineOverscrollSlopX} + 1ch)`,
    minHeight: "1lh",
});

export const codeBlockToolbarClassName = style({
    pointerEvents: "none",
    zIndex: "0",
    position: "sticky",
    left: "0",
    height: "0",
    width: "100%",
    marginLeft: `-${codeBlockLineOverscrollSlopX}`,
    marginRight: `-${codeBlockLineOverscrollSlopX}`,
    // Override `cursor: text` and `user-select: text` set on the content editor.
    cursor: "auto",
    userSelect: "none",
});

export const codeBlockToolbarFlexClassName = style({
    pointerEvents: "auto",
    position: "absolute",
    top: "0",
    right: "0",
    height: codeBlockToolbarHeight,
    paddingLeft: spacing["1.5"],
    display: "flex",
    alignItems: "center",
    backgroundColor: backgroundColorVar,
    maxWidth: subtractRemLengths(
        desktopCodeBlockToolbarMaxWidth,
        // The overflow gradient is rendered absolutely out of this element's layout
        // but we still want to consider it as a part of the max width.
        codeBlockPaddingRight,
    ),
    selectors: {
        [`${mobilePlatformSelector} &`]: {
            maxWidth: subtractRemLengths(
                mobileCodeBlockToolbarMaxWidth,
                // The overflow gradient is rendered absolutely out of this element's layout
                // but we still want to consider it as a part of the max width.
                codeBlockPaddingRight,
            ),
        },
    },
});

export const codeBlockToolbarOverflowGradientClassName = style({
    pointerEvents: "none",
    position: "absolute",
    top: 0,
    bottom: 0,
    left: `-${codeBlockPaddingRight}`,
    width: codeBlockPaddingRight,
    background: `linear-gradient(to left, ${backgroundColorVar}, transparent)`,
});

export const codeBlockLanguagePickerClassName = style({
    height: codeBlockToolbarHeight,
    paddingLeft: spacing["1.5"],
    paddingRight: spacing["1.5"],
    display: "flex",
    alignItems: "center",
    borderRadius: borderRadius["1"],
    // Don't allow item to grow beyond flexbox bounds. By default flexbox items
    // have `min-width: auto` which extends with content.
    // https://stackoverflow.com/a/66689926/1568890
    minWidth: "0",
});

export const codeBlockLanguagePickerTextClassName = style({
    ...fontStyles["truncate"],
    ...fontSizes["75"],
    color: colorSchemeVars["grey-60"],
});

export const codeBlockCopyButtonClassName = style({
    flexShrink: "0",
    width: codeBlockToolbarHeight,
    height: codeBlockToolbarHeight,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: borderRadius["full"],
    selectors: {
        [`${mobilePlatformSelector} &`]: {
            display: "none",
        },
    },
});

export const codeBlockCopyButtonIconClassName = style({
    width: spacing["4"],
    height: spacing["4"],
});

globalStyle(dividerClassName, {
    ...blockStyles,
    marginTop: spacing[desktopHeading1TopMargin],
    marginBottom: spacing[desktopHeading1TopMargin],
    borderColor: colorSchemeVars["grey-10"],
    userSelect: "none",
});

globalStyle(
    [
        `${mobilePlatformSelector} ${dividerClassName}`,
        `${withMobileLayoutDocClassName} ${dividerClassName}`,
    ].join(", "),
    {
        marginTop: spacing[mobileHeading1TopMargin],
        marginBottom: spacing[mobileHeading1TopMargin],
    },
);

const minFileSize = spacing["20"];
export const minFileSizeRem = parseRemLengthNumber(minFileSize);

const fileRowMaxHeight = spacing["128"];
export const fileRowMaxHeightRem = parseRemLengthNumber(fileRowMaxHeight);

const fileRowGapWidth = spacing["2.5"];
export const fileRowGapWidthRem = parseRemLengthNumber(fileRowGapWidth);

globalStyle(fileRowClassName, {
    ...blockStyles,
    position: "relative",
    marginTop: paragraphMarginVar,
    marginBottom: paragraphMarginVar,
    display: "grid",
    justifyContent: "center",
    gap: fileRowGapWidth,
    minHeight: minFileSize,
    maxHeight: fileRowMaxHeight,
});

globalStyle(`${fileRowClassName}:has(+ ${fileRowClassName})`, {
    marginBottom: fileRowGapWidth,
});

globalStyle(`${fileRowClassName} + ${fileRowClassName}`, {
    marginTop: fileRowGapWidth,
});

export const fileFloatMaxWidthPercent = 1 / 3;

const fileFloatLeftMarginX = spacing["5"];
export const fileFloatLeftMarginXRem = parseRemLengthNumber(fileFloatLeftMarginX);

// We have less horizontal margin for a right float since the text's right
// ragged edge already creates some whitespace. So let longer lines of text
// flow closer to the file.
const fileFloatRightMarginX = spacing["3"];
export const fileFloatRightMarginXRem = parseRemLengthNumber(fileFloatRightMarginX);

const fileFloatMarginY = spacing["1"];
export const fileFloatMarginYRem = parseRemLengthNumber(fileFloatMarginY);

export const fileFloatMinHeightParagraphLineCount = Math.ceil(
    minFileSizeRem / paragraphLineHeightRem,
);
export const fileFloatMinHeightRem = fileFloatMinHeightParagraphLineCount * paragraphLineHeightRem;

export const fileFloatMaxHeightParagraphLineCount = 16;
export const fileFloatMaxHeightRem = fileFloatMaxHeightParagraphLineCount * paragraphLineHeightRem;

globalStyle(fileFloatClassName, {
    clear: "both",
    display: "grid",
    gridTemplateColumns: "100% 0",
    paddingTop: fileFloatMarginY,
    paddingBottom: fileFloatMarginY,
});

// [Clearfix][1] our floated files. CSS floats used to be very popular as they
// were the solution for creating header/sidebar layouts which today are now
// common across basically all websites. CSS floats aren't used for this
// purpose anymore since CSS flexbox and CSS grid are much better solutions for
// this problem.
//
// When floats were popular, most floats came with a "clearfix". This made sure
// the parent element adopted the height of the floated element. We probably
// need this for our floated files too.
//
// For further reading there's a good article on floats by Chris Coyier called
// "[All About Floats][2]".
//
// [1]: https://stackoverflow.com/questions/8554043/what-is-a-clearfix
// [2]: https://css-tricks.com/all-about-floats/
globalStyle(`${fileFloatClassName}::after`, {
    content: '""',
    display: "table",
    clear: "both",
});

globalStyle(fileFloatLeftClassName, {
    float: "left",
    paddingRight: fileFloatLeftMarginX,
    marginLeft: `max(0rem, (100% - ${blockMaxWidth.desktop}) / 2)`,
});

globalStyle(`${mobilePlatformSelector} ${fileFloatLeftClassName}`, {
    marginLeft: `max(0rem, (100% - ${blockMaxWidth.mobile}) / 2)`,
});

globalStyle(fileFloatRightClassName, {
    float: "right",
    paddingLeft: fileFloatRightMarginX,
    marginRight: `max(0rem, (100% - ${blockMaxWidth.desktop}) / 2)`,
});

globalStyle(`${mobilePlatformSelector} ${fileFloatRightClassName}`, {
    marginRight: `max(0rem, (100% - ${blockMaxWidth.mobile}) / 2)`,
});

// NOTE(calebmer): Make sure we don't set `user-select: none` on files since we
// want the `<img>` inside to get the browser's selection effect.
globalStyle(fileClassName, {
    zIndex: "10",
    position: "relative",
    overflow: "hidden",
    minWidth: minFileSize,
    minHeight: minFileSize,
    maxHeight: fileRowMaxHeight,
    // Files have an interactive pointer cursor as a hint that when you click on a
    // file it opens up the file viewer. The file alone is not obviously
    // interactive.
    cursor: "pointer",
});

// If the user's pointer is down and they're dragging to change the selection
// then we don't want our files to have an interactive pointer cursor.
//
// We repeat the selection change pointer down class twice so it has a higher
// precedence than our CSS selector in `content_editor.css.ts` that changes the
// cursor to `default` while the shift or alt key is pressed.
globalStyle(
    `${selectionChangeDraggingClassName}${selectionChangeDraggingClassName} ${fileClassName}`,
    {
        cursor: "inherit",
    },
);

export const selectionFileClassNameByColor = createObjectFromKeys(themeColors, color =>
    style({
        selectors: {
            // We use `&::after` to avoid competing with the `&::before` selector for
            // `pressedFileClassName`.
            "&::after": {
                content: '""',
                zIndex: "20",
                position: "absolute",
                top: "0",
                bottom: "0",
                left: "0",
                right: "0",
                backgroundColor: colorSchemeVars[`${color}-selection`],
                opacity: 0.8,
            },
        },
    }),
);

export const pressedFileClassName = style({
    selectors: {
        // We use `&::before` to avoid competing with the `&::after` selector for
        // `selectionFileClassNameByColor`.
        "&::before": {
            content: '""',
            zIndex: "20",
            position: "absolute",
            top: "0",
            bottom: "0",
            left: "0",
            right: "0",
            backgroundColor: colorSchemeVars["grey-100-const"],
            opacity: buttonPressedOverlayOpacity / 2,
        },
    },
});

// After a long press releasing won't open the attachment viewer. So set cursor to
// `default` to communicate this.
export const longPressedFileClassName = style({
    cursor: "default",
});

// Our code doesn't have a background color! This is an intentional design
// decision but also has some technical justification.
//
// The design justification is that putting a background color on inline
// code:
//
// - Makes it stand out. Applying a code style to text should not be like
//   applying bold or italics. Your eye should not be drawn to the inline code
//   style. Your eye will be drawn to a different font but less than a
//   background color.
// - Hard to distinguish with a mention bubble. If both mentions and code use a
//   bubble style they start to get a little tricky to distinguish.
// - Clashes with the speech bubble background color for messages.
//
// From a technical perspective, if we add background color then we also
// probably want to add `paddingLeft` and `paddingRight` to give the code a
// little space. The problem is text highlighting does not highlight the
// horizontal padding of inline elements! This gives you a janky feeling when
// highlighting code where the beginning and end aren't highlighted. Cursor
// highlights aren't the only way to highlight code:
//
// - Cursor highlight as you drag to select text
// - Highlight style in documents (e.g. highlight red)
// - Phantom selections from other collaborative document users
//
// All of these have gaps around the horizontal padding in code.
//
// If in the future we try to give code a background color please consider how
// to technically implement continuous selection. One option could be to use
// `box-shadow` to extend the bounds of the inline code. This won't change the
// layout but it creates a similar effect. Another option is to insert
// invisible backtick (`) characters in the DOM. When you copy/paste content
// you'd get text that looks like markdown styles and correct selection. Seems
// like a reasonable tradeoff.
globalStyle(codeClassName, {
    ...fontStyles.code,
    wordWrap: "break-word",
    boxDecorationBreak: "clone",
});

globalStyle(boldClassName, {
    ...fontStyles["extra-bold"],
    // Inherit font feature settings from parent instead of turning them off. In a
    // link they should be off (which `fontStyles` does). Outside of a link they
    // should be on.
    fontFeatureSettings: "inherit",
});

globalStyle(`${codeClassName} ${boldClassName}`, {
    ...fontStyles["code-extra-bold"],
});

globalStyle(`${codeBlockClassName} ${boldClassName}`, {
    ...fontStyles["code-extra-bold"],
});

globalStyle(`${headingLevel1ClassName} ${boldClassName}`, {
    ...fontStyles["ultra-bold"],
});

globalStyle(`${headingLevel2ClassName} ${boldClassName}`, {
    ...fontStyles["ultra-bold"],
});

globalStyle(`${headingLevel3ClassName} ${boldClassName}`, {
    ...fontStyles["ultra-bold"],
});

globalStyle(italicClassName, {
    fontStyle: "italic",
});

globalStyle(`${codeClassName} ${italicClassName}`, {
    // Italics in our code font is controlled by a variable font setting instead of
    // `font-style: italic`.
    fontVariationSettings: '"ital" 1',
});

globalStyle(`${codeBlockClassName} ${italicClassName}`, {
    // Italics in our code font is controlled by a variable font setting instead of
    // `font-style: italic`.
    fontVariationSettings: '"ital" 1',
});

globalStyle(strikeClassName, {
    textDecorationLine: "line-through",
    textDecorationThickness: 1,
});

export const emojiClassName = style({
    fontFamily: emojiFontFamily,
});

const commentBackgroundColors = {
    light: {
        default: Color(colors["yellow-50"]).fade(0.7).hexa(),
        active: Color(colors["yellow-50"]).fade(0.2).hexa(),
    },
    dark: {
        default: Color(colors["yellow-60"]).fade(0.7).hexa(),
        active: Color(colors["yellow-50"]).fade(0.4).hexa(),
    },
};

const nestedCommentBackgroundColors = {
    light: mapObjectValues(commentBackgroundColors.light, backgroundColor => {
        const color1 = blendColors(colors["grey-0"], commentBackgroundColors.light.default);
        const color2 = blendColors(colors["grey-0"], backgroundColor);
        return color1 !== color2
            ? extrapolateHighlightColor(color1, color2, Color(backgroundColor).alpha())
            : "transparent";
    }),
    dark: mapObjectValues(commentBackgroundColors.dark, backgroundColor => {
        const color1 = blendColors(
            invertedColorsWithShade["grey-0"],
            commentBackgroundColors.dark.default,
        );
        const color2 = blendColors(invertedColorsWithShade["grey-0"], backgroundColor);
        return color1 !== color2
            ? extrapolateHighlightColor(color1, color2, Color(backgroundColor).alpha())
            : "transparent";
    }),
};

globalStyle(commentClassName, {
    color: "inherit",
    backgroundColor: commentBackgroundColors.light.default,
    // Extend the comment background color to the line height.
    paddingTop: `calc((1lh - ${backgroundFontSizePercentage}em) / 2)`,
    paddingBottom: `calc((1lh - ${backgroundFontSizePercentage}em) / 2)`,
});

globalStyle(`${commentClassName} ${commentClassName}`, {
    backgroundColor: nestedCommentBackgroundColors.light.default,
});

globalStyle(`${darkColorSchemeSelector} ${commentClassName}`, {
    backgroundColor: commentBackgroundColors.dark.default,
});

globalStyle(`${darkColorSchemeSelector} ${commentClassName} ${commentClassName}`, {
    backgroundColor: nestedCommentBackgroundColors.dark.default,
});

globalStyle(`:is(${fileRowClassName}, ${fileFloatClassName}) ${commentClassName}`, {
    position: "relative",
    display: "grid",
    backgroundColor: "transparent",
    paddingTop: 0,
    paddingBottom: 0,
});

globalStyle(`:is(${fileRowClassName}, ${fileFloatClassName}) ${commentClassName}::after`, {
    content: '""',
    position: "absolute",
    backgroundColor: "transparent",
    // `inset` and `borderRadius` is based on the `<FocusRing>` we render when the
    // file is selected. The focus ring should render on top of the file.
    inset: -4,
    borderRadius: 4,
});

globalStyle(`:is(${fileRowClassName}, ${fileFloatClassName}) > ${commentClassName}::after`, {
    backgroundColor: commentBackgroundColors.light.default,
});

globalStyle(
    `${darkColorSchemeSelector} :is(${fileRowClassName}, ${fileFloatClassName}) > ${commentClassName}::after`,
    {
        backgroundColor: commentBackgroundColors.dark.default,
    },
);

// Use a pointer cursor for comments in a mobile layout since the comment opens
// in a bottom sheet and disables interactivity with the document. Since
// clicking a comment is a more disruptive state shift in mobile layouts, we
// find it useful to give a pointer cursor affordance.
globalStyle(`${withMobileLayoutDocClassName} ${commentClassName}`, {
    cursor: "pointer",
});

const highlightOpacity = 0.8;

// We want the highlight color to equal a color in our color scheme. We also
// want the color to be somewhat transparent so if we're highlighting an element/
// with a background shape (like mentions) you can see the background shape
// through the highlight. We accomplish this by extrapolating a color that when
// rendered on top of our background color will equal the target
// highlight color.
mapObjectValues(colorByHighlightColor, (color, highlightColor) => {
    globalStyle(highlightClassNameByColor[highlightColor], {
        color: "inherit",
        backgroundColor: extrapolateHighlightColor(
            colors["grey-0"],
            colors[color],
            highlightOpacity,
        ),
    });

    globalStyle(`${darkColorSchemeSelector} ${highlightClassNameByColor[highlightColor]}`, {
        backgroundColor: extrapolateHighlightColor(
            invertedColorsWithShade["grey-0"],
            invertedColorsWithShade[color],
            highlightOpacity,
        ),
    });

    globalStyle(`${commentClassName} ${highlightClassNameByColor[highlightColor]}`, {
        backgroundColor: extrapolateHighlightColorFlippingCommentHighlightColorStackingOrder(
            colors["grey-0"],
            commentBackgroundColors.light.default,
            colors[color],
            highlightOpacity,
        ),
    });

    globalStyle(
        `${darkColorSchemeSelector} ${commentClassName} ${highlightClassNameByColor[highlightColor]}`,
        {
            backgroundColor: extrapolateHighlightColorFlippingCommentHighlightColorStackingOrder(
                invertedColorsWithShade["grey-0"],
                commentBackgroundColors.dark.default,
                invertedColorsWithShade[color],
                highlightOpacity,
            ),
        },
    );
});

export const phantomSelectionClassName = style({
    paddingTop: `calc((1lh - ${backgroundFontSizePercentage}em) / 2)`,
    paddingBottom: `calc((1lh - ${backgroundFontSizePercentage}em) / 2)`,
});

// Syntax highlighting color philosophy:
//
// - Use the theme color for keywords and values to match the space theme
// - Use an analogous (similar) color to the theme color (preferably lighter)
//   for types since they describe the values
// - Use a complimentary (opposite) color to the theme color for secondary
//   keywords that define control flow we want to draw the eye to
// - Use complimentary (opposite) colors for strings and numbers so the reader
//   can easily differentiate them
//
// TODO(calebmer): Primary keywords and values should use the theme color. All
// colors should change to adapt to whatever the theme color is. Right now we
// hardcode a syntax highlighting theme for `indigo`.
const codeBlockPrimaryKeywordColor = colorSchemeVars["indigo-60"];
const codeBlockSecondaryKeywordColor = colorSchemeVars["pink-60"];
const codeBlockTypeColor = colorSchemeVars["cyan-60"];
const codeBlockValueColor = {
    lightColor: colorSchemeVars["indigo-80"],
    darkColor: colorSchemeVars["indigo-90"],
};
const codeBlockStringLiteralColor = colorSchemeVars["green-60"];
const codeBlockNumberLiteralColor = colorSchemeVars["orange-60"];

/**
 * Color for each of the highlight class names generated by the
 * [Lezer parser][1].
 *
 * [1]: https://lezer.codemirror.net/docs/ref/#highlight.classHighlighter
 */
const colorByLezerHighlightSelector: {
    [key: string]:
        | string
        | {color?: string; lightColor?: string; darkColor?: string; weight?: "semi-bold"}
        | null;
} = {
    ".tok-link": codeBlockStringLiteralColor, // Used for `[link](url)` in Markdown
    ".tok-url": null, // Used for `[link](url)` in Markdown
    ".tok-heading": {color: codeBlockPrimaryKeywordColor, weight: "semi-bold"}, // Used for `# Heading` in Markdown
    ".tok-emphasis": {color: codeBlockPrimaryKeywordColor, weight: "semi-bold"}, // Used for `_emphasis_` in Markdown
    ".tok-strong": {color: codeBlockPrimaryKeywordColor, weight: "semi-bold"}, // Used for `**strong**` in Markdown
    ".tok-keyword": {color: codeBlockPrimaryKeywordColor, weight: "semi-bold"},
    ".tok-keyword.tok-controlKeyword": codeBlockSecondaryKeywordColor,
    ".tok-keyword.tok-moduleKeyword": codeBlockSecondaryKeywordColor,
    ".tok-atom": {color: codeBlockPrimaryKeywordColor, weight: "semi-bold"}, // Used for `super()` in JavaScript
    ".tok-bool": {color: codeBlockSecondaryKeywordColor, weight: "semi-bold"},
    ".tok-labelName": codeBlockStringLiteralColor,
    ".tok-inserted": colorSchemeVars["green-60"],
    ".tok-deleted": colorSchemeVars["red-60"],
    ".tok-literal": codeBlockNumberLiteralColor,
    ".tok-string": codeBlockStringLiteralColor,
    ".tok-string2": codeBlockStringLiteralColor,
    ".tok-number": codeBlockNumberLiteralColor,
    ".tok-variableName": codeBlockValueColor,
    ".tok-typeName": codeBlockTypeColor,
    ".tok-namespace": codeBlockTypeColor,
    ".tok-className": codeBlockValueColor,
    ".tok-macroName": codeBlockNumberLiteralColor, // Used for macros like `println!()` in Rust
    ".tok-propertyName": codeBlockValueColor,
    ".tok-operator": null,
    ".tok-comment": colorSchemeVars["grey-50"],
    ".tok-meta": null, // Used for annotations like `#[derive(Serializable)]` in Rust
    ".tok-punctuation": null,
    ".tok-punctuation2": codeBlockPrimaryKeywordColor, // Used for template string interpolation `${}` in JavaScript
    ".tok-invalid": null,
};

for (const [lezerHighlightSelector, color] of Object.entries(colorByLezerHighlightSelector)) {
    if (color === null) continue;

    const options = typeof color === "string" ? {color} : color;

    if (!options.weight) {
        globalStyle(`${codeBlockLineContentClassName} ${lezerHighlightSelector}`, {
            color: options.color ?? options.lightColor,
        });
    } else {
        globalStyle(`${codeBlockLineContentClassName} ${lezerHighlightSelector}`, {
            color: options.color ?? options.lightColor,
            ...fontStyles[`code-${options.weight}`],
        });

        globalStyle(`${codeBlockLineContentClassName} ${boldClassName} ${lezerHighlightSelector}`, {
            ...fontStyles["code-extra-bold"],
        });
    }

    if (options.darkColor) {
        globalStyle(
            `${darkColorSchemeSelector} ${codeBlockLineContentClassName} ${lezerHighlightSelector}`,
            {
                color: options.darkColor,
            },
        );
    }
}

export const commentActiveDynamicCssTemplate = `\
#$containerId ${commentClassName}[data-comment="$commentThreadId"] {background-color: ${
    commentBackgroundColors.light.active
}}
#$containerId ${commentClassName} ${commentClassName}[data-comment="$commentThreadId"] {background-color: ${
    nestedCommentBackgroundColors.light.active
}}
${darkColorSchemeSelector} #$containerId ${commentClassName}[data-comment="$commentThreadId"] {background-color: ${
    commentBackgroundColors.dark.active
}}
${darkColorSchemeSelector} #$containerId ${commentClassName} ${commentClassName}[data-comment="$commentThreadId"] {background-color: ${
    nestedCommentBackgroundColors.dark.active
}}
#$containerId :is(${fileRowClassName}, ${fileFloatClassName}) ${commentClassName}[data-comment="$commentThreadId"] {background-color: transparent}
#$containerId :is(${fileRowClassName}, ${fileFloatClassName}) ${commentClassName}[data-comment="$commentThreadId"]::after {background-color: ${
    commentBackgroundColors.light.active
}}
#$containerId :is(${fileRowClassName}, ${fileFloatClassName}) > ${commentClassName}:not([data-comment="$commentThreadId"]):has(${commentClassName}[data-comment="$commentThreadId"])::after {background-color: transparent}
${(Object.keys(colorByHighlightColor) as Array<keyof typeof highlightClassNameByColor>)
    .map(
        highlightColor => `\
#$containerId ${commentClassName}[data-comment="$commentThreadId"] ${
            highlightClassNameByColor[highlightColor]
        } {background-color: ${extrapolateHighlightColorFlippingCommentHighlightColorStackingOrder(
            colors["grey-0"],
            commentBackgroundColors.light.active,
            colors[colorByHighlightColor[highlightColor]],
            highlightOpacity,
        )}}
${darkColorSchemeSelector} #$containerId ${commentClassName}[data-comment="$commentThreadId"] ${
            highlightClassNameByColor[highlightColor]
        } {background-color: ${extrapolateHighlightColorFlippingCommentHighlightColorStackingOrder(
            invertedColorsWithShade["grey-0"],
            commentBackgroundColors.dark.active,
            invertedColorsWithShade[colorByHighlightColor[highlightColor]],
            highlightOpacity,
        )}}`,
    )
    .join("\n")}
`;

/**
 * The highlight mark renders on top of the comment mark in the DOM. This is
 * necessary so that when we hover/click the highlight mark it acts as one unit.
 * However, we want the visual appearance of the comment highlight color rendering
 * on top of the highlight color. So with some color math we compute a color to
 * produce this effect.
 */
function extrapolateHighlightColorFlippingCommentHighlightColorStackingOrder(
    _backgroundColor: string,
    _commentHighlightColor: string,
    _highlightColor: string,
    opacity: number,
) {
    const backgroundColor = parseRawColor(_backgroundColor);
    const commentHighlightColor = parseRawColor(_commentHighlightColor);
    const highlightColor = parseRawColor(_highlightColor);

    // Get the background color when the comment highlight is rendering on top
    // of it.
    const commentHighlightOnBackgroundColor = blendRawColors(
        backgroundColor,
        commentHighlightColor,
    );

    // Get the highlight color when the comment highlight is rendering on top
    // of it.
    const commentHighlightOnHighlightColor = blendRawColors(highlightColor, commentHighlightColor);

    // Get a color that will be our desired highlight color on top of the background
    // with the comment highlight color.
    const color = extrapolateHighlightRawColorWithoutBounds(
        commentHighlightOnBackgroundColor,
        commentHighlightOnHighlightColor,
        opacity,
    );

    assert(
        0 <= color.r &&
            color.r <= 255 &&
            0 <= color.g &&
            color.g <= 255 &&
            0 <= color.b &&
            color.b <= 255,
        `Can not extrapolate outside RGB color space, got color: rgb(${color.r}, ${color.g}, ${color.b})`,
    );

    return printRawColor(color);
}

function blendRawColors(color1: RawColor, color2: RawColor): RawColor {
    const r = lerp(color1.r, color2.r, color2.alpha);
    const g = lerp(color1.g, color2.g, color2.alpha);
    const b = lerp(color1.b, color2.b, color2.alpha);
    const alpha = color1.alpha + color2.alpha * (1 - color1.alpha);
    return {r, g, b, alpha};
}

function blendColors(color1: string, color2: string): string {
    return printRawColor(blendRawColors(parseRawColor(color1), parseRawColor(color2)));
}

globalStyle(linkClassName, {
    color: colorSchemeVars["theme-60"],
    // Don't change the caret color when your selector is in a link.
    caretColor: colorSchemeVars["grey-100"],
    textDecorationLine: "underline",
    textDecorationThickness: 1,
    // Remove gaps in links underline in iOS 8+ and Safari 8+.
    // Adobe Spectrum does this and I trust them:
    // https://github.com/adobe/spectrum-css/blob/0623bc93472afe3df13702531e119b62ad5291f2/components/link/index.css#L51-L52
    WebkitTextDecorationSkip: "objects",
    // Turn off contextual alternatives which may look weird in URLs or other
    // machine generated strings. For example, our IDs look weird when you have 3x9
    // randomly generated in the string.
    fontFeatureSettings: '"calt" off',
});

// Inert links use a `<span>` element.
globalStyle(`a${linkClassName}`, {
    // Links use a pointer cursor. See:
    // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
    cursor: "pointer",
});

// Use the caret color of the parent text node block.
globalStyle(`${quoteBlockClassName} ${linkClassName}`, {
    caretColor: colorSchemeVars["grey-60"],
});

globalStyle(`${checkListItemCheckedClassName} ${linkClassName}`, {
    caretColor: colorSchemeVars["grey-60"],
});

export const linkPressedClassName = style({
    selectors: {
        // Increase the precedence to beat `color` on `linkClassName`.
        [`&${linkClassName}`]: {
            color: colorSchemeVars["theme-60-opacity-60"],
        },
        // Increase the precedence to beat `color` on `linkClassName`.
        [`${darkColorSchemeSelector} &${linkClassName}`]: {
            color: colorSchemeVars["theme-70-opacity-60"],
        },
    },
});

// In dark mode, highlighted link text color is a little too dark. So brighten
// link color just a little so it's not too out-of-place but at least the link
// text is easier to read.
globalStyle(
    Object.values(highlightClassNameByColor)
        .map(
            highlightClassName =>
                `${darkColorSchemeSelector} ${linkClassName} ${highlightClassName}`,
        )
        .join(", "),
    {
        color: colorSchemeVars["theme-70"],
        textDecorationLine: "underline",
        textDecorationThickness: 1,
    },
);

globalStyle(
    Object.values(highlightClassNameByColor)
        .map(
            highlightClassName =>
                `${darkColorSchemeSelector} ${linkPressedClassName} ${highlightClassName}`,
        )
        .join(", "),
    {
        color: colorSchemeVars["theme-70-opacity-60"],
    },
);

export const mentionClassName = style({
    position: "relative",
});

export const currentAccountMentionBackgroundOpacity = 0.6;

export const currentAccountMentionClassName = style({
    color: colorSchemeVars["theme-60"],
    selectors: {
        // Put the background color in an absolutely positioned element so the
        // highlight color renders on top of it.
        "&::after": {
            content: "''",
            position: "absolute",
            zIndex: -10,
            top: 0,
            bottom: 0,
            left: `-${spacing["0.5"]}`,
            right: `-${spacing["0.5"]}`,
            backgroundColor: colorSchemeVars["theme-10"],
            opacity: currentAccountMentionBackgroundOpacity,
            borderRadius: borderRadius["1"],
        },
        [`${darkColorSchemeSelector} &`]: {
            color: colorSchemeVars["theme-80"],
        },
        [`${darkColorSchemeSelector} &::after`]: {
            backgroundColor: colorSchemeVars["theme-40"],
            opacity: 0.4,
        },
    },
});

export const mentionAtClassName = style({
    fontFeatureSettings: '"case" 1',
});

export const mentionTextClassName = style({
    fontWeight: fontStyles["semi-bold"].fontWeight,
    selectors: {
        // Inherit font weight if we are in a container that is bolder than us.
        [`${boldClassName} &`]: {fontWeight: "inherit"},
        [`${headingLevel1ClassName} &`]: {fontWeight: "inherit"},
        [`${headingLevel2ClassName} &`]: {fontWeight: "inherit"},
        [`${headingLevel3ClassName} &`]: {fontWeight: "inherit"},
    },
});

// Make sure the first child in our document never has top margin.
const firstChildSelectors = [
    `${docClassName} > *:first-child`,
    `${docClassName} > ${listItemClassName}:first-child > *:first-child`,
    `${docClassName} > ${listItemClassName}:first-child > ${checkListItemContentClassName} > *:first-child`,
    `${docClassName} > ${quoteBlockClassName}:first-child > *:first-child`,
    `${docClassName} > ${quoteBlockClassName}:first-child > ${listItemClassName}:first-child > *:first-child`,
    `${docClassName} > ${quoteBlockClassName}:first-child > ${listItemClassName}:first-child > ${checkListItemContentClassName} > *:first-child`,
];
firstChildSelectors.forEach(selector => globalStyle(selector, {marginTop: 0}));

// Make sure the last child in our document never has bottom margin.
const lastChildSelectors = [
    `${docClassName} > *:last-child`,
    `${docClassName} > ${listItemClassName}:last-child > *:last-child`,
    `${docClassName} > ${listItemClassName}:last-child > ${checkListItemContentClassName} > *:last-child`,
    `${docClassName} > ${quoteBlockClassName}:last-child > *:last-child`,
    `${docClassName} > ${quoteBlockClassName}:last-child > ${listItemClassName}:last-child > *:last-child`,
    `${docClassName} > ${quoteBlockClassName}:last-child > ${listItemClassName}:last-child > ${checkListItemContentClassName} > *:last-child`,
];
lastChildSelectors.forEach(selector => globalStyle(selector, {marginBottom: 0}));

const blockChildSelectors = [
    `${listItemClassName} > ${paragraphClassName}`,
    `${checkListItemContentClassName} > ${paragraphClassName}`,
    `${quoteBlockClassName} > ${paragraphClassName}`,
    `${quoteBlockClassName} > ${listItemClassName}`,
];
blockChildSelectors.forEach(selector => globalStyle(selector, {paddingRight: 0}));

export const emptyTitleClassName = style({});

globalStyle(`${emptyTitleClassName} > ${titleClassName}[data-placeholder]::before`, {
    // The `/ ""` is screen reader alt text. So screen readers don't read the
    // placeholder content.
    //
    // Not all browsers support that syntax, though (like Safari), so we provide a
    // fallback without the `/ ""`.
    content: ["attr(data-placeholder)", 'attr(data-placeholder) / ""'],
    pointerEvents: "none",
    // Uses a bold font weight for the title.
    ...omitObject(inputPlaceholderStyles, ["fontWeight"]),
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
    ...inputPlaceholderStyles,
    position: "absolute",
    // Make sure placeholder is rendered underneath cursor.
    zIndex: -10,
});
