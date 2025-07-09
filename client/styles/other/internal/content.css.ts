import {assignVars, createGlobalTheme, createVar, globalStyle, style} from "@vanilla-extract/css";
import Color from "color";
import {
    accentThemeBackgroundColor,
    accentThemeForegroundColor,
    backgroundColorVar,
    backgroundFontSizePercentage,
    borderRadius,
    colorSchemeVars,
    darkColorSchemeSelector,
    desktopPlatformSelector,
    elevationVars,
    emojiFontFamily,
    fontSizes,
    fontStyles,
    inputPlaceholderStyles,
    largeSpacingScaleSelector,
    lightColorSchemeSelector,
    mediumSpacingScaleSelector,
    mobilePlatformSelector,
    selectorBySpacingScale,
} from "~/client/styles/core/styles_core.js";
import {buttonPressedOverlayOpacity} from "~/client/styles/other/internal/button.css.js";
import * as contentFileVideoPlayerStyles from "~/client/styles/other/internal/content_file_video_player.css.js";
import {
    extrapolateHighlightColor,
    extrapolateHighlightRawColorWithoutBounds,
} from "~/client/styles/other/internal/helpers/extrapolate_highlight_color.js";
import {navigationBarHeight} from "~/client/styles/other/internal/navigation_bar.css.js";
import {
    boldClassName,
    checkListItemCheckedClassName,
    codeBlockClassName,
    codeBlockLineClassName,
    codeBlockLineContentClassName,
    codeBlockWrapperClassName,
    codeClassName,
    commentClassName,
    dividerClassName,
    fileClassName,
    fileFloatClassName,
    fileFloatLeftClassName,
    fileFloatRightClassName,
    fileRowLikeClassName,
    headingLevel1ClassName,
    headingLevel2ClassName,
    headingLevel3ClassName,
    highlightClassNameByColor,
    italicClassName,
    linkClassName,
    listItemClassName,
    listItemIndentationVar,
    orderedListItemClassName,
    paragraphClassName,
    quoteBlockClassName,
    strikeClassName,
    tableWrapper2ClassName,
    tableWrapper3ClassName,
    tableWrapperClassName,
    titleClassName,
    unorderedListItemClassName,
} from "~/shared/content/content_styles.js";
import {colors} from "~/shared/design/core/colors.js";
import {FontSize, fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {RawColor, parseRawColor, printRawColor} from "~/shared/design/core/helpers/raw_color.js";
import {colorByHighlightColor} from "~/shared/design/core/highlight_color.js";
import {invertedColorsWithShade} from "~/shared/design/core/inverted_colors.js";
import {Platform} from "~/shared/design/core/platform.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    convertRemLengthToPx,
    parseRemLength,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {
    SpacingScale,
    allSpacingScales,
    remPxBySpacingScale,
} from "~/shared/design/core/spacing_scale.js";
import {themeColors} from "~/shared/design/core/theme_colors.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {lerp} from "~/shared/helpers/number/lerp.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";

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
//   https://alpine.inc/s/111hc413nfdxa6vwspnhm3ejsc/documents/wshttcjr5egq22e11k92tq1z7m
// - Documents feel like they need a tighter width and more whitespace (more
//   line height + more space between paragraphs). Thinking about this while
//   writing:
//   https://alpine.inc/s/111hc413nfdxa6vwspnhm3ejsc/documents/r0jzswspqf11nmy1g0zh3n6y4r

// We've optimized file preview image resize widths (see
// `getFilePreviewImageResizeWidth()`) to align with our content max width.
// Specifically we depend on `blockMaxWidth` being 600px on desktop. If you
// adjust this value, consider also adjusting file preview image resize widths.
const contentMaxWidthSpacing = "160";
export {contentMaxWidthSpacing as contentMaxWidth};
const contentMaxWidth = spacing[contentMaxWidthSpacing];

export const blockMaxWidth = mapObjectValues(screenPaddingX, screenPaddingX =>
    subtractRemLengths(contentMaxWidth, screenPaddingX, screenPaddingX),
);
export const blockMaxWidthRem = mapObjectValues(blockMaxWidth, blockMaxWidth =>
    parseRemLength(blockMaxWidth),
);

const paragraphMarginSpacing = "2";
const paragraphMargin = spacing[paragraphMarginSpacing];
export {paragraphMarginSpacing as paragraphMargin};
export const paragraphMarginRem = parseRemLength(paragraphMargin);

const standaloneBlockMarginSpacing = "4";
const standaloneBlockMargin = spacing[standaloneBlockMarginSpacing];
export {standaloneBlockMarginSpacing as standaloneBlockMargin};
export const standaloneBlockMarginRem = parseRemLength(standaloneBlockMargin);

const blockMaxWidthVar = createVar("block-max-width");

globalStyle(":root", {
    vars: {
        [blockMaxWidthVar]: blockMaxWidth.desktop,
    },
});

globalStyle(mobilePlatformSelector, {
    vars: {
        [blockMaxWidthVar]: blockMaxWidth.mobile,
    },
});

export const docClassName = style({
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

export const narrowRouteLayoutDocClassName = style({});

export const isDraggingSelectionDocClassName = style({});

export const withoutBlockMaxWidthDocClassName = style({
    selectors: {
        [`${docClassName}&`]: {
            vars: {
                [blockMaxWidthVar]: "none",
            },
        },
    },
});

export const withUserSelectNoneDocClassName = style({
    selectors: {
        [`${docClassName}&`]: {
            userSelect: "none",
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

export const paragraphActualFontSize = "100";

export const paragraphLineHeightMultiple = 1.5;

export const paragraphLineHeightPx = createObjectFromKeys(allSpacingScales, spacingScale =>
    Math.ceil(
        fontSizesBySpacingScale[paragraphActualFontSize][spacingScale].fontSize *
            paragraphLineHeightMultiple,
    ),
);

export const paragraphLineHeightVar = createVar("paragraph-line-height");

globalStyle(":root", {
    vars: {
        [paragraphLineHeightVar]: `${paragraphLineHeightPx.small}px`,
    },
});

globalStyle(mediumSpacingScaleSelector, {
    vars: {
        [paragraphLineHeightVar]: `${paragraphLineHeightPx.medium}px`,
    },
});

globalStyle(largeSpacingScaleSelector, {
    vars: {
        [paragraphLineHeightVar]: `${paragraphLineHeightPx.large}px`,
    },
});

export const paragraphFontSize = {
    ...fontSizes[paragraphActualFontSize],
    lineHeight: paragraphLineHeightVar,
} as const;

globalStyle(paragraphClassName, {
    ...omitObject(blockStyles, ["clear"]),
    ...fontStyles.normal,
    ...paragraphFontSize,
    // Make sure this node always takes up space even if it is empty. Important
    // when we are rendering placeholders in `<ContentView>`.
    minHeight: paragraphLineHeightVar,
    marginTop: paragraphMargin,
    marginBottom: paragraphMargin,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

// Header sizes are smaller on mobile than desktop because mobile has less
// horizontal space than desktop. So we want to fit more header on a
// single line.
export const titleFontSize = {wide: "800", narrow: "700"} as const;

export const headingLevel1FontSize = {wide: "600", narrow: "500"} as const;
export const headingLevel2FontSize = {wide: "400", narrow: "350-narrow-heading"} as const;
export const headingLevel3FontSize = {wide: "200", narrow: "200"} as const;

export const heading1TopMargin = {wide: "10", narrow: "8"} as const;
export const heading2TopMargin = {wide: "8", narrow: "6"} as const;
export const heading3TopMargin = {wide: "6", narrow: "5"} as const;
export const heading4TopMargin = {wide: "4", narrow: "4"} as const;

const headingMarginVars = createGlobalTheme(":root", {
    heading1TopMargin: spacing[heading1TopMargin.wide],
    heading2TopMargin: spacing[heading2TopMargin.wide],
    heading3TopMargin: spacing[heading3TopMargin.wide],
    heading4TopMargin: spacing[heading4TopMargin.wide],
});

globalStyle(narrowRouteLayoutDocClassName, {
    vars: assignVars(headingMarginVars, {
        heading1TopMargin: spacing[heading1TopMargin.narrow],
        heading2TopMargin: spacing[heading2TopMargin.narrow],
        heading3TopMargin: spacing[heading3TopMargin.narrow],
        heading4TopMargin: spacing[heading4TopMargin.narrow],
    }),
});

export const titlePaddingTop = {
    mobileNarrow: addRemLengths("3", navigationBarHeight),
    desktopWide: addRemLengths("10", navigationBarHeight),
    desktopNarrow: addRemLengths("0", navigationBarHeight),
};

const titleLetterSpacingFactor = 0.6;

globalStyle(titleClassName, {
    ...blockStyles,
    ...fontStyles["bold"],
    ...fontSizes[titleFontSize.wide],
    // Use a bolder font weight for titles than `bold` but `extra-bold` is too
    // much. Find something visually pleasing between that which helps titles
    // really stand out.
    fontWeight: 650,
    // The letter spacing is too tight for bold text at this font size. Ease up
    // a bit on the letter spacing.
    letterSpacing: `calc(${
        fontSizes[titleFontSize.wide].letterSpacing
    } * ${titleLetterSpacingFactor})`,
    paddingTop: `calc(${titlePaddingTop.desktopWide} + var(--safe-area-inset-top, 0px))`,
    // Make sure this node always takes up space even if it is empty. Important
    // when we are rendering placeholders in `<ContentView>`.
    minHeight: `calc(${fontSizes[titleFontSize.wide].lineHeight} + ${titlePaddingTop.desktopWide})`,
    marginBottom: paragraphMargin,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

globalStyle(`${narrowRouteLayoutDocClassName} ${titleClassName}`, {
    ...fontSizes[titleFontSize.narrow],
    letterSpacing: `calc(${
        fontSizes[titleFontSize.narrow].letterSpacing
    } * ${titleLetterSpacingFactor})`,
    paddingTop: `calc(${titlePaddingTop.desktopNarrow} + var(--safe-area-inset-top, 0px))`,
    minHeight: `calc(${fontSizes[titleFontSize.narrow].lineHeight} + ${
        titlePaddingTop.desktopNarrow
    })`,
});

globalStyle(
    [
        `${mobilePlatformSelector} ${titleClassName}`,
        `${mobilePlatformSelector} ${narrowRouteLayoutDocClassName} ${titleClassName}`,
    ].join(", "),
    {
        ...fontSizes[titleFontSize.narrow],
        paddingTop: `calc(${titlePaddingTop.mobileNarrow} + var(--safe-area-inset-top, 0px))`,
        minHeight: `calc(${fontSizes[titleFontSize.narrow].lineHeight} + ${
            titlePaddingTop.mobileNarrow
        })`,
    },
);

globalStyle(headingLevel1ClassName, {
    ...blockStyles,
    ...fontStyles["bold"],
    ...fontSizes[headingLevel1FontSize.wide],
    marginTop: headingMarginVars.heading1TopMargin,
    marginBottom: paragraphMargin,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

globalStyle(`${narrowRouteLayoutDocClassName} ${headingLevel1ClassName}`, {
    ...fontSizes[headingLevel1FontSize.narrow],
});
globalStyle(`${titleClassName} + ${headingLevel1ClassName}`, {
    marginTop: headingMarginVars.heading4TopMargin,
});

globalStyle(headingLevel2ClassName, {
    ...blockStyles,
    ...fontStyles["bold"],
    ...fontSizes[headingLevel2FontSize.wide],
    marginTop: headingMarginVars.heading2TopMargin,
    marginBottom: paragraphMargin,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

globalStyle(`${narrowRouteLayoutDocClassName} ${headingLevel2ClassName}`, {
    ...fontSizes[headingLevel2FontSize.narrow],
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
    ...fontSizes[headingLevel3FontSize.wide],
    marginTop: headingMarginVars.heading3TopMargin,
    marginBottom: paragraphMargin,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

globalStyle(`${narrowRouteLayoutDocClassName} ${headingLevel3ClassName}`, {
    ...fontSizes[headingLevel3FontSize.narrow],
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

const quoteBlockIndentationSpacing = "3";
const quoteBlockIndentation = spacing[quoteBlockIndentationSpacing];
const quoteBlockBorderWidth = "0.1875rem";

export const brandIconDefaultColor = "grey-80";

export const mentionEntityIconColorVar = createVar("mention-entity-icon-color");

globalStyle(":root", {
    vars: {
        [mentionEntityIconColorVar]: colorSchemeVars[brandIconDefaultColor],
    },
});

globalStyle(quoteBlockClassName, {
    ...omitObject(blockStyles, ["clear"]),
    position: "relative",
    paddingLeft: quoteBlockIndentation,
    marginTop: standaloneBlockMargin,
    marginBottom: standaloneBlockMargin,
    color: colorSchemeVars["grey-60"],
    caretColor: colorSchemeVars["grey-60"],
    vars: {
        [mentionEntityIconColorVar]: colorSchemeVars["grey-60"],
    },
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
export const listItemIndentationRem = parseRemLength(listItemIndentation);

const unorderedListItemBulletSizeSpacing = "1.5";
const unorderedListItemBulletSize = spacing[unorderedListItemBulletSizeSpacing];
export {unorderedListItemBulletSizeSpacing as unorderedListItemBulletSize};

globalStyle(listItemClassName, {
    ...omitObject(blockStyles, ["clear"]),
    position: "relative",
    paddingLeft: `calc((${listItemIndentationVar} + 1) * ${listItemIndentation})`,
    // NOTE(calebmer, 2025-05-02): I'm conflicted on whether to keep or remove
    // standalone block margins for list items. The advantage is that it makes
    // documents look nice. Here are some of the disadvantages:
    //
    // - It's weird when you type `*` and spacing gets added
    // - Floating files between list items adds standalone margin which is weird
    // - Editors like the share overlay description editor and task notes that are
    //   based on paragraph line heights aren't as clean when list items have
    //   standalone block margin
    //
    // The advantage of documents looking better is pretty good, though. So I
    // tolerate these disadvantages. Some we can workaround, e.g. we should be
    // able to detect when there's only a floating file between two list items.
    marginTop: standaloneBlockMargin,
    marginBottom: standaloneBlockMargin,
});

globalStyle(`${listItemClassName} + ${listItemClassName}`, {
    marginTop: 0,
});

globalStyle(`${listItemClassName}:has(+ ${listItemClassName})`, {
    marginBottom: 0,
});

export const unorderedListItemBulletTop = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        (paragraphLineHeightPx[spacingScale] -
            convertRemLengthToPx(unorderedListItemBulletSize, spacingScale)) /
        2,
);

export const unorderedListItemBulletLeft = `calc((${listItemIndentationVar} * ${listItemIndentation}) + ${
    parseRemLength(listItemIndentation) / 2 - parseRemLength(unorderedListItemBulletSize) / 2
}rem)`;

globalStyle(`${unorderedListItemClassName}::before`, {
    content: '""',
    position: "absolute",
    backgroundColor: "currentColor",
    borderRadius: "50%",
    pointerEvents: "none",
    width: unorderedListItemBulletSize,
    height: unorderedListItemBulletSize,
    top: unorderedListItemBulletTop.small,
    left: unorderedListItemBulletLeft,
});

globalStyle(`${mediumSpacingScaleSelector} ${unorderedListItemClassName}::before`, {
    top: unorderedListItemBulletTop.medium,
});

globalStyle(`${largeSpacingScaleSelector} ${unorderedListItemClassName}::before`, {
    top: unorderedListItemBulletTop.large,
});

globalStyle(`${orderedListItemClassName}::before`, {
    content: 'attr(data-list-number) "."',
    position: "absolute",
    pointerEvents: "none",
    top: 0,
    left: `calc((${listItemIndentationVar} * ${listItemIndentation}) + ${spacing["6"]})`,
    textAlign: "right",
    transform: "translateX(-100%)",
    ...paragraphFontSize,
    fontVariantNumeric: "tabular-nums",
});

const checkListItemCheckboxSize: Record<Platform, Spacing> = {desktop: "4", mobile: "5"};

globalStyle(checkListItemCheckedClassName, {
    color: colorSchemeVars["grey-60"],
    caretColor: colorSchemeVars["grey-60"],
});

export const checkListItemContentClassName = style({});

const getCheckListItemCheckboxContainerPosition = (
    platform: Platform,
    spacingScale: SpacingScale,
) => ({
    top: `${
        (paragraphLineHeightPx[spacingScale] -
            convertRemLengthToPx(checkListItemCheckboxSize[platform], spacingScale)) /
        2
    }px`,
    left: `calc((${listItemIndentationVar} * ${listItemIndentation}) + ${
        parseRemLength(listItemIndentation) / 2 -
        (parseRemLength(checkListItemCheckboxSize[platform]) + parseRemLength("1") * 2) / 2
    }rem)`,
});

// The checkbox is a little small. Add some extra hit area to make it easier
// to click.
export const checkListItemCheckboxContainerClassName = style({
    position: "absolute",
    ...getCheckListItemCheckboxContainerPosition("desktop", "small"),
    borderRadius: "100%",
    paddingLeft: spacing["1"],
    paddingRight: spacing["1"],
    cursor: "default",
    userSelect: "none",
    selectors: {
        [`${desktopPlatformSelector}${mediumSpacingScaleSelector} &`]:
            getCheckListItemCheckboxContainerPosition("desktop", "medium"),
        [`${desktopPlatformSelector}${largeSpacingScaleSelector} &`]:
            getCheckListItemCheckboxContainerPosition("desktop", "large"),
        [`${mobilePlatformSelector} &`]: getCheckListItemCheckboxContainerPosition(
            "mobile",
            "small",
        ),
        [`${mobilePlatformSelector}${mediumSpacingScaleSelector} &`]:
            getCheckListItemCheckboxContainerPosition("mobile", "medium"),
        [`${mobilePlatformSelector}${largeSpacingScaleSelector} &`]:
            getCheckListItemCheckboxContainerPosition("mobile", "large"),
    },
});

// TODO(calebmer): We also need a disabled style for this checkbox when the
// checkbox is read-only.
export const checkListItemCheckboxClassName = style({
    position: "relative",
    overflow: "hidden",
    borderRadius: "100%",
    width: spacing[checkListItemCheckboxSize.desktop],
    height: spacing[checkListItemCheckboxSize.desktop],
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
            width: spacing[checkListItemCheckboxSize.mobile],
            height: spacing[checkListItemCheckboxSize.mobile],
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
    width: spacing["2.5"],
    height: spacing["2.5"],
    transform: `translate(-50%, -50%) scale(${
        parseInt(checkListItemCheckboxSize.desktop, 10) / 4
    })`,
    pointerEvents: "none",
    selectors: {
        [`${mobilePlatformSelector} &`]: {
            transform: `translate(-50%, -50%) scale(${
                parseInt(checkListItemCheckboxSize.mobile, 10) / 4
            })`,
        },
    },
});

const mobileCodeBlockToolbarMaxWidth = spacing["32"];
const desktopCodeBlockToolbarMaxWidth = addRemLengths(mobileCodeBlockToolbarMaxWidth, "6");

// Padding right needs to be a bit wider than the overflow gradient width so
// that when we're selecting text and Chrome selects some space after the end
// of the line (to represent a new line) it isn't covered with a gradient.
const codeBlockOverflowGradientWidth = spacing["3"];
const codeBlockPaddingRight = spacing["6"];

globalStyle(codeBlockWrapperClassName, {
    ...blockStyles,
    position: "relative",
    zIndex: "0",
    overflowX: "auto",
    overflowY: "hidden",
    overscrollBehaviorX: "contain",
    marginTop: standaloneBlockMargin,
    marginBottom: standaloneBlockMargin,
    counterReset: "code-block-line-number",
    ...paragraphFontSize,
    // `fontStyles.code` needs to be second to override `letter-spacing`.
    ...fontStyles.code,
});

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
});

// The reason use a triple selector is to beat the CSS set by ProseMirror since
// ProseMirror automatically sets white space to pre-wrap.
globalStyle(`${codeBlockClassName}${codeBlockClassName}${codeBlockClassName}`, {
    whiteSpace: "pre",
});

export const filePreviewCodeBlockClassName = style({});

// Change styles for code block in file preview.
globalStyle(`${filePreviewCodeBlockClassName}${codeBlockWrapperClassName}`, {
    height: "100%",
    maxWidth: "none",
    overflowX: "hidden",
    overflowY: "hidden",
    margin: 0,
});

const fileViewCodeBlockMargin = spacing["3"];

export const fileViewCodeBlockClassName = style({});

globalStyle(`${fileViewCodeBlockClassName}${codeBlockWrapperClassName}`, {
    height: "100%",
    maxWidth: "none",
    margin: 0,
    paddingTop: fileViewCodeBlockMargin,
    paddingBottom: `calc(${fileViewCodeBlockMargin} + var(--safe-area-inset-bottom, 0px))`,
    overflowY: "auto",
    overscrollBehaviorY: "contain",
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
    // Make sure we have a text cursor when hovering over a code block in a
    // `<ContentView>`. For some reason `cursor: auto` doesn't use a text cursor in
    // Chrome. We haven't debugged why this is.
    cursor: "text",
});

globalStyle(`${codeBlockLineClassName}::before`, {
    content: "counter(code-block-line-number)",
    flexShrink: "0",
    pointerEvents: "none",
    zIndex: "10",
    position: "sticky",
    left: "0",
    marginLeft: `-${codeBlockLineOverscrollSlopX}`,
    width: listItemIndentation,
    // Optically align code block numbers with ordered list item numbers.
    paddingRight: "0.75rem",
    textAlign: "right",
    color: colorSchemeVars["grey-30"],
    // No gradient for the line number. We have a hard border to create the
    // illusion of the line number column sliding over the code.
    backgroundColor: backgroundColorVar,
    ...fontStyles["code-light"],
});

// Add some extra margin to the left of code block file views.
globalStyle(
    `${codeBlockWrapperClassName}${fileViewCodeBlockClassName} ${codeBlockLineClassName}::before`,
    {
        width: addRemLengths(fileViewCodeBlockMargin, listItemIndentation),
    },
);

globalStyle(`${codeBlockLineClassName}::after`, {
    content: '""',
    flexShrink: "0",
    pointerEvents: "none",
    zIndex: "0",
    position: "sticky",
    // Render in margins to make sure there are no rendering artifacts.
    right: `-${codeBlockOverflowGradientWidth}`,
    width: addRemLengths(codeBlockPaddingRight, codeBlockOverflowGradientWidth),
    height: paragraphFontSize.lineHeight,
    background: `linear-gradient(to right, transparent ${subtractRemLengths(
        codeBlockPaddingRight,
        codeBlockOverflowGradientWidth,
    )}, ${backgroundColorVar} ${codeBlockPaddingRight}, ${backgroundColorVar})`,
});

globalStyle(`${largeSpacingScaleSelector} ${codeBlockLineClassName}::after`, {
    height: paragraphFontSize.lineHeight,
});

// Turn off sticky right edge gradient on file previews and file views. Since
// the right edge has a hard cut and doesn't blend into the document
// background.
globalStyle(
    `${codeBlockWrapperClassName}:is(${filePreviewCodeBlockClassName}, ${fileViewCodeBlockClassName}) ${codeBlockLineClassName}::after`,
    {
        content: "none",
    },
);

globalStyle(
    `${desktopPlatformSelector} ${codeBlockWrapperClassName}:not(:is(${filePreviewCodeBlockClassName}, ${fileViewCodeBlockClassName})) > ${codeBlockClassName} > ${codeBlockLineClassName}:first-child`,
    {
        paddingRight: desktopCodeBlockToolbarMaxWidth,
    },
);

globalStyle(
    `${mobilePlatformSelector} ${codeBlockWrapperClassName}:not(:is(${filePreviewCodeBlockClassName}, ${fileViewCodeBlockClassName})) > ${codeBlockClassName} > ${codeBlockLineClassName}:first-child`,
    {
        paddingRight: mobileCodeBlockToolbarMaxWidth,
    },
);

globalStyle(`${codeBlockClassName} > ${codeBlockLineClassName}:first-child::after`, {
    content: "none",
});

globalStyle(`${codeBlockWrapperClassName}${fileViewCodeBlockClassName} ${codeBlockLineClassName}`, {
    paddingRight: fileViewCodeBlockMargin,
});

globalStyle(codeBlockLineContentClassName, {
    position: "relative",
    zIndex: "0",
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
    height: paragraphLineHeightVar,
    paddingLeft: spacing["1.5"],
    display: "flex",
    alignItems: "center",
    gap: spacing["0.5"],
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
    left: `-${codeBlockOverflowGradientWidth}`,
    width: codeBlockOverflowGradientWidth,
    background: `linear-gradient(to left, ${backgroundColorVar}, transparent)`,
});

export const codeBlockLanguagePickerClassName = style({
    height: paragraphLineHeightVar,
    paddingLeft: spacing["1"],
    paddingRight: spacing["1"],
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
    width: paragraphLineHeightVar,
    height: paragraphLineHeightVar,
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
    marginTop: spacing[heading1TopMargin.wide],
    marginBottom: spacing[heading1TopMargin.wide],
    borderColor: colorSchemeVars["grey-10"],
    userSelect: "none",
});

globalStyle(`${narrowRouteLayoutDocClassName} ${dividerClassName}`, {
    marginTop: spacing[heading1TopMargin.narrow],
    marginBottom: spacing[heading1TopMargin.narrow],
});

/**
 * The minimum width of a column in absolute units. The table data structure
 * may think the column is smaller but this is as small as we'll let the column
 * actually render in practice.
 *
 * The minimum column width is one sixth of the block width on desktop. Even as
 * we scale down this is still our minimum column width so we make sure content
 * in columns are legible even at small sizes.
 */
export const tableColumnMinWidthRem = blockMaxWidthRem.desktop * (1 / 6);

/**
 * The maximum width of a column in absolute units. The table data structure
 * may think the column is larger but this is as large as we'll let the column
 * actually render in practice.
 *
 * The maximum column width is the width of the larger column in a two column
 * table on desktop where one of the columns is the minimum width and the
 * `tableWidth` is 1 (so about three fourths of the block width on desktop).
 */
export const tableColumnMaxWidthRem = blockMaxWidthRem.desktop - tableColumnMinWidthRem;

/**
 * The number of table columns up under which we'll try to maintain the table's
 * width. After this many columns, adding a new column or resizing a column
 * will change the table's width.
 *
 * When we add a new column (past this column count) we want the width of the
 * new column to be the block width divided by this count.
 */
export const tableMaxColumnCountForMaintainingBlockWidth = 4;

/**
 * Snap factor for column resizing. By default, when resizing a column we
 * snap the column width to `blockWidth / factor`. The column min width, column
 * max width, and new column desired width should all be multiples of this
 * increment when we have the max block width. So the user can easily create
 * columns of those sizes and there will be harmony between the user's column
 * sizes.
 */
export const tableColumnWidthBlockWidthSnapFactor = 12;

const tableCellPaddingYSpacing = "2";
const tableCellPaddingY = spacing[tableCellPaddingYSpacing];
export {tableCellPaddingYSpacing as tableCellPaddingY};

// Align table cell content with quote block content.
const tableCellPaddingXSpacing = quoteBlockIndentationSpacing;
const tableCellPaddingX = spacing[tableCellPaddingXSpacing];
export {tableCellPaddingXSpacing as tableCellPaddingX};
export const tableCellPaddingXRem = parseRemLength(tableCellPaddingX);

// File min size is derived from the smallest context a file may render in, a
// table column at minimum width.
export const fileMinSizeRem = tableColumnMinWidthRem - tableCellPaddingXRem * 2;
export const fileMinSize: RemLength = `${fileMinSizeRem}rem`;

const fileRowMaxHeightSpacing = "128";
export {fileRowMaxHeightSpacing as fileRowMaxHeight};
const fileRowMaxHeight = spacing[fileRowMaxHeightSpacing];

const fileRowGapWidthSpacing = "2";
export {fileRowGapWidthSpacing as fileRowGapWidth};
const fileRowGapWidth = spacing[fileRowGapWidthSpacing];
export const fileRowGapWidthRem = parseRemLength(fileRowGapWidth);

globalStyle(fileRowLikeClassName, {
    ...blockStyles,
    position: "relative",
    marginTop: standaloneBlockMargin,
    marginBottom: standaloneBlockMargin,
    display: "grid",
    justifyContent: "center",
    gap: fileRowGapWidth,
    minHeight: fileMinSize,
    maxHeight: fileRowMaxHeight,
    userSelect: "none",
});

globalStyle(`${fileRowLikeClassName}:has(+ ${fileRowLikeClassName})`, {
    marginBottom: fileRowGapWidth,
});

globalStyle(`${fileRowLikeClassName} + ${fileRowLikeClassName}`, {
    marginTop: fileRowGapWidth,
});

export const fileFloatMaxWidthAsIfFairlySplitFileCount = 3;

const fileFloatLeftMarginX = spacing["5"];
export const fileFloatLeftMarginXRem = parseRemLength(fileFloatLeftMarginX);

// We have less horizontal margin for a right float since the text's right
// ragged edge already creates some whitespace. So let longer lines of text
// flow closer to the file.
const fileFloatRightMarginX = spacing["3"];
export const fileFloatRightMarginXRem = parseRemLength(fileFloatRightMarginX);

const fileFloatMarginY = spacing["1"];
export const fileFloatMarginYRem = parseRemLength(fileFloatMarginY);

export const fileFloatMinHeightParagraphLineCount = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        Math.ceil(
            (fileMinSizeRem * remPxBySpacingScale[spacingScale]) /
                paragraphLineHeightPx[spacingScale],
        ),
);

export const fileFloatMinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        fileFloatMinHeightParagraphLineCount[spacingScale] * paragraphLineHeightPx[spacingScale],
);

export const fileFloatMaxHeightParagraphLineCount = 16;

export const fileFloatMaxHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale => fileFloatMaxHeightParagraphLineCount * paragraphLineHeightPx[spacingScale],
);

globalStyle(fileFloatClassName, {
    clear: "both",
    display: "grid",
    gridTemplateColumns: "100% 0",
    paddingTop: fileFloatMarginY,
    paddingBottom: fileFloatMarginY,
    userSelect: "none",
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

globalStyle(fileClassName, {
    zIndex: "10",
    position: "relative",
    overflow: "hidden",
    minWidth: fileMinSize,
    minHeight: fileMinSize,
    maxHeight: fileRowMaxHeight,
    // Files have an interactive pointer cursor as a hint that when you click on a
    // file it opens up the file viewer. The file alone is not obviously
    // interactive.
    cursor: "pointer",
    userSelect: "none",
    // We use `mix-blend-mode` for our cross fade animation. Without
    // `isolation: isolate` the background color will be taken into account when
    // mixing the colors from our placeholder `<img>` and content `<img>` with
    // `mix-blend-mode: plus-lighter`.
    isolation: "isolate",
});

globalStyle(`${fileClassName} > *`, {
    pointerEvents: "none",
});

export const fileImageViewerClassName = style({
    selectors: {
        [`${fileClassName}&`]: {
            minWidth: "auto",
            minHeight: "auto",
            maxHeight: "none",
            borderRadius: 0,
            cursor: "inherit",
        },
    },
});

export const alwaysShowFileBorderClassName = style({});
export const withoutFileSelectionClassName = style({});

export const fileBlankImageForSelectionClassName = style({
    position: "absolute",
    inset: "0",
    width: "100%",
    height: "100%",
    userSelect: "text",
    pointerEvents: "none",
    // `z-index` needs to render over code block line numbers and floating video
    // player UI.
    zIndex: "70",
    selectors: {
        [`${fileClassName}${withoutFileSelectionClassName} &`]: {
            display: "none",
            userSelect: "none",
        },
    },
});

export const fileTransparentBackgroundClassName = style({});

export const fileNearBlackClassName = style({
    selectors: {
        [`${darkColorSchemeSelector} &${fileTransparentBackgroundClassName}`]: {
            backgroundColor: colors["grey-0"],
        },
    },
});

export const fileNearWhiteClassName = style({
    selectors: {
        [`${lightColorSchemeSelector} &${fileTransparentBackgroundClassName}`]: {
            backgroundColor: colors["grey-100"],
        },
    },
});

export const fileEntityClassName = style({
    borderRadius: spacing["1.5"],
    backgroundColor: colorSchemeVars["grey-0"],
    boxShadow: elevationVars["elevation-5-without-border"],
});

// If the user's pointer is down and they're dragging to change the selection
// then we don't want our files to have an interactive pointer cursor.
//
// We repeat the selection change pointer down class twice so it has a higher
// precedence than our CSS selector in `content_editor.css.ts` that changes the
// cursor to `default` while the shift or alt key is pressed.
globalStyle(
    `${isDraggingSelectionDocClassName}${isDraggingSelectionDocClassName} ${fileClassName}`,
    {
        cursor: "inherit",
    },
);

export const selectionFileClassNameByColor = createObjectFromKeys(themeColors, color =>
    style({
        selectors: {
            // We use `&::after` to avoid competing with the `&::before` selector for
            // `pressedFileClassName`.
            [`${fileClassName}&::after`]: {
                content: '""',
                pointerEvents: "none",
                // Should render over `<video>` element for video preview (`z-index` 30) and
                // video controls (`z-index` 50).
                zIndex: "60",
                position: "absolute",
                top: "0",
                bottom: "0",
                left: "0",
                right: "0",
                backgroundColor: colorSchemeVars[`${color}-selection`],
                opacity: 0.8,
            },
            [`${fileClassName}${fileEntityClassName}&::after`]: {
                borderRadius: spacing["1.5"],
            },
        },
    }),
);

// We add a border around images to prevent images from bleeding into the
// background. Say you have a screenshot of a web design with an off white
// background. Rendering that without a border on our pure white background
// will confuse the viewer's eye since the background of the image "bleeds"
// into our document background. Adding a border helps contain the image to
// the viewer's eye. The border is low opacity to operate more like a
// shadow and blend with the image.
//
// We use `&::before` to avoid competing with the `&::after` selector for
// `selectionFileClassNameByColor`.
globalStyle(`${fileClassName}:not(${fileImageViewerClassName})::before`, {
    content: '""',
    pointerEvents: "none",
    // Should render over `<video>` element for video preview (`z-index` 30).
    zIndex: "40",
    position: "absolute",
    inset: "0",
    boxShadow: `inset 0 0 0 0.5px ${colorSchemeVars["grey-5-translucent"]}`,
});

globalStyle(`${fileClassName}${fileEntityClassName}:not(${fileImageViewerClassName})::before`, {
    borderRadius: spacing["1.5"],
    boxShadow: "none",
    border: `solid 1px ${colorSchemeVars["grey-10-translucent"]}`,
});

// Turn off borders for files with a transparent background.
//
// If the file is near black or near white then we want to keep the border in a
// matching color scheme since we add an opposite background color to make the
// image visible.
//
// We always want to render the border for files rendered in
// `<ChannelViewAside>`.
globalStyle(
    `${lightColorSchemeSelector} ${fileClassName}${fileTransparentBackgroundClassName}:not(${fileNearWhiteClassName}):not(${alwaysShowFileBorderClassName})::before`,
    {boxShadow: "none"},
);

// Turn off borders for files with a transparent background.
//
// If the file is near black or near white then we want to keep the border in a
// matching color scheme since we add an opposite background color to make the
// image visible.
//
// We always want to render the border for files rendered in
// `<ChannelViewAside>`.
globalStyle(
    `${darkColorSchemeSelector} ${fileClassName}${fileTransparentBackgroundClassName}:not(${fileNearBlackClassName}):not(${alwaysShowFileBorderClassName})::before`,
    {boxShadow: "none"},
);

const pressedFileBackgroundColor = Color(colorSchemeVars["grey-100-const"]);

export const pressedFileClassName = style({
    selectors: {
        // We use `&::before` to avoid competing with the `&::after` selector for
        // `selectionFileClassNameByColor`.
        [`${fileClassName}&::before`]: {
            backgroundColor: Color.rgb([
                pressedFileBackgroundColor.red(),
                pressedFileBackgroundColor.green(),
                pressedFileBackgroundColor.blue(),
                buttonPressedOverlayOpacity / 2,
            ]).hexa(),
        },
    },
});

// After a long press releasing won't open the attachment viewer. So set cursor to
// `default` to communicate this. This is also a hint to the user that other
// interactions are possible. Like dragging.
export const longPressedFileClassName = style({
    cursor: "default",
});

export const loadedFileImagePreviewClassName = style({});

export const loadedFileImageAnimationDurationMs = 250;

export const fileImagePreviewContentClassName = style({
    zIndex: "0",
    position: "absolute",
    // While most images are 100% and 100% height, we need to center images smaller
    // than `fileMinSize`.
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "100%",
    height: "100%",
    objectPosition: "center top",
    objectFit: "cover",
    // Images need to be selectable so we get Chrome's selection highlight
    // effect.
    userSelect: "text",
    // Start at opacity 0. We'll animate to opacity 1 when
    // `loadedFileImagePreviewClassName` is added.
    opacity: 0,
    selectors: {
        [`${fileClassName}${loadedFileImagePreviewClassName} &`]: {
            opacity: 1,
            // We only add `transition` when the loaded class name has been added. This way
            // we animate from unloaded -> loaded but not from loaded -> unloaded (which
            // happens when the file source is replaced).
            transition: `opacity ${loadedFileImageAnimationDurationMs}ms ease-in-out`,
        },
        [[
            // Turn off selection on mobile. Specifically for mobile Safari where allowing
            // text selection for images leads us to some weird states where Safari renders
            // a text selection in addition to our ProseMirror `NodeSelection`.
            `${mobilePlatformSelector} &`,
            // Turn off selection styles if our preview has a video player. Since for video
            // players we render an invisible `<img>` with `user-select: text` that renders
            // on top of the video controls. Otherwise video controls would render over
            // the selection style which looks wrong.
            `${fileClassName}:has(${contentFileVideoPlayerStyles.containerClassName}) &`,
            // Turn off selection in channel view asides. The user shouldn't be able to
            // select anything there.
            `${fileClassName}${withoutFileSelectionClassName} &`,
        ].join(", ")]: {
            userSelect: "none",
        },
    },
});

// Any preview in dark mode that doesn't have an image is rendered directly on
// `grey-0`. So apply a color that should change the background color to
// `grey-5` on press.
globalStyle(`${pressedFileClassName}:not(:has(${fileImagePreviewContentClassName}))::before`, {
    backgroundColor: colorSchemeVars["grey-5-translucent"],
});

export const fileImagePreviewPlaceholderClassName = style({
    zIndex: "10",
    position: "absolute",
    // While most images are 100% and 100% height, we need to center images smaller
    // than `fileMinSize`.
    top: "50%",
    left: "50%",
    transform: `translate(-50%, -50%)`,
    width: "100%",
    height: "100%",
    objectPosition: "center top",
    objectFit: "cover",
    pointerEvents: "none",
    // Start at opacity 1. We'll animate to opacity 0 when
    // `loadedFileImagePreviewClassName` is added.
    opacity: 1,
    selectors: {
        [`${fileClassName}${loadedFileImagePreviewClassName} &`]: {
            opacity: 0,
            // Proper cross-fade animation with `plus-lighter`. Otherwise the element goes
            // to 75% opacity in the middle of the animation since when compositing element
            // opacities multiply instead of add. Read more here:
            //
            // https://jakearchibald.com/2021/dom-cross-fade/
            mixBlendMode: "plus-lighter",
            // We only add `transition` when the loaded class name has been added. This way
            // we animate from unloaded -> loaded but not from loaded -> unloaded (which
            // happens when the file source is replaced).
            transition: `opacity ${loadedFileImageAnimationDurationMs}ms ease-in-out`,
        },
    },
});

export const fileChannelEntityPreviewSubscribeButtonBellIconClassName = style({
    width: spacing["3"],
    height: spacing["3"],
});

export const fileChannelEntityPreviewSubscribeButtonBellRingingIconClassName = style({
    display: "none",
    width: spacing["3"],
    height: spacing["3"],
});

export const fileChannelEntityPreviewSubscribeButtonSpinnerGapIconClassName = style({
    display: "none",
    width: spacing["3"],
    height: spacing["3"],
});

export const fileChannelEntityPreviewSubscribeButtonClassName = style({
    position: "relative",
    zIndex: "0",
    overflow: "hidden",
    width: "fit-content",
    height: spacing["7"],
    paddingLeft: spacing["2.5"],
    paddingRight: spacing["2.5"],
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing["1"],
    borderRadius: spacing["1"],
    backgroundColor: colorSchemeVars["grey-90"],
    color: colorSchemeVars["grey-0"],
    fill: colorSchemeVars["grey-0"],
    ...fontSizes["75"],
    // Same font weight used by `<Button>` for neutral variant.
    fontWeight: 425,
    // This button is clickable independently of the rest of the entity
    // preview card.
    pointerEvents: "auto",
    cursor: "default",
    selectors: {
        "&::after": {
            content: '"Subscribe"',
        },
        [`${darkColorSchemeSelector} &`]: {
            backgroundColor: colorSchemeVars["grey-100"],
        },
    },
});

const fileChannelEntityPreviewSubscribeButtonSubscribedSelector = `${fileChannelEntityPreviewSubscribeButtonClassName}:is([data-subscribed=true], [data-subscribed-override=true]):not([data-subscribed-override=false])`;

globalStyle(fileChannelEntityPreviewSubscribeButtonSubscribedSelector, {
    backgroundColor: colorSchemeVars["grey-5"],
    color: colorSchemeVars["grey-40"],
    fill: colorSchemeVars["grey-40"],
    fontWeight: 400,
});

globalStyle(`${fileChannelEntityPreviewSubscribeButtonSubscribedSelector}::after`, {
    content: '"Subscribed"',
});

// Make sure we override the unsubscribed `darkColorSchemeSelector` selector
// that changes background color.
globalStyle(
    `${darkColorSchemeSelector} ${fileChannelEntityPreviewSubscribeButtonSubscribedSelector}`,
    {backgroundColor: colorSchemeVars["grey-5"]},
);

globalStyle(
    `${fileChannelEntityPreviewSubscribeButtonSubscribedSelector}:not([data-loading-indicator]) ${fileChannelEntityPreviewSubscribeButtonBellIconClassName}`,
    {display: "none"},
);

globalStyle(
    `${fileChannelEntityPreviewSubscribeButtonSubscribedSelector}:not([data-loading-indicator]) ${fileChannelEntityPreviewSubscribeButtonBellRingingIconClassName}`,
    {display: "block"},
);

globalStyle(
    `${fileChannelEntityPreviewSubscribeButtonClassName}[data-loading-indicator] ${fileChannelEntityPreviewSubscribeButtonBellIconClassName}`,
    {display: "none"},
);

globalStyle(
    `${fileChannelEntityPreviewSubscribeButtonClassName}[data-loading-indicator] ${fileChannelEntityPreviewSubscribeButtonSpinnerGapIconClassName}`,
    {display: "block"},
);

export const fileChannelEntityPreviewSubscribeButtonPressedClassName = style({
    selectors: {
        [`${fileChannelEntityPreviewSubscribeButtonClassName}&::before`]: {
            content: '""',
            position: "absolute",
            inset: "0",
            zIndex: "10",
            backgroundColor: colorSchemeVars["grey-100-const"],
            pointerEvents: "none",
            opacity: buttonPressedOverlayOpacity,
        },
    },
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

globalStyle(`${headingLevel3ClassName} ${strikeClassName}`, {
    textDecorationThickness: 1.49,
});

globalStyle(`${headingLevel2ClassName} ${strikeClassName}`, {
    textDecorationThickness: 2,
});

globalStyle(`${headingLevel1ClassName} ${strikeClassName}`, {
    textDecorationThickness: 2.49,
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

// Lots of resolutions since the resolution changes as the user zooms in (on
// Chrome at least).
const resolutions = [1, 2, 3, 4, 5, 6] as const;

const inlineBackgroundPaddingPx = createObjectFromKeys(allSpacingScales, spacingScale => {
    const padding =
        paragraphLineHeightPx[spacingScale] -
        fontSizesBySpacingScale[paragraphActualFontSize][spacingScale].fontSize *
            backgroundFontSizePercentage;

    const get = (method: "floor" | "ceil", resolution: number) =>
        Math[method]((Math.round(padding * resolution) / resolution / 2) * resolution) / resolution;

    return createObjectFromKeys(resolutions, resolution => ({
        floor: `${get("floor", resolution)}px`,
        ceil: `${get("ceil", resolution)}px`,
    }));
});

/**
 * You apply these padding values as `padding-top` and `padding-bottom` of an
 * inline variable whose background (usually a color expressed with
 * `background-color`) you want to extend for the text's full line height.
 * Instead of just the text box.
 *
 * Getting these values right is pretty delicate business.
 *
 * - It depends on font metrics which determine how much space a font occupies
 *   relative to its `font-size`.
 *
 * - You need to be careful with subpixel rounding or else you'll get super
 *   thin overlap between lines of text which looks wrong.
 *
 * - Different browsers perform text rendering differently.
 *
 * So we create CSS variables that we store proper padding top/bottom values in
 * pixels. And use a combination of media queries and selectors to pick the
 * right values.
 */
const inlineBackgroundPadding = createGlobalTheme(":root", {
    top: inlineBackgroundPaddingPx.small[1].floor,
    bottom: inlineBackgroundPaddingPx.small[1].ceil,
});

for (const spacingScale of allSpacingScales) {
    for (const resolution of resolutions) {
        // Handled by default variable values.
        if (spacingScale === "small" && resolution === 1) continue;

        const selector = spacingScale === "small" ? ":root" : selectorBySpacingScale[spacingScale];

        if (resolution === 1) {
            globalStyle(selector, {
                vars: assignVars(inlineBackgroundPadding, {
                    top: inlineBackgroundPaddingPx[spacingScale][resolution].floor,
                    bottom: inlineBackgroundPaddingPx[spacingScale][resolution].ceil,
                }),
            });
        } else {
            globalStyle(selector, {
                "@media": {
                    [`(min-resolution: ${resolution}x)`]: {
                        vars: assignVars(inlineBackgroundPadding, {
                            top: inlineBackgroundPaddingPx[spacingScale][resolution].floor,
                            bottom: inlineBackgroundPaddingPx[spacingScale][resolution].ceil,
                        }),
                    },
                },
            });
        }
    }
}

// WebKit has some other calculation for padding top/bottom on inline elements
// we don't understand. Leading to padding top/bottom not perfectly lining up
// in WebKit. We've hardcoded 2px as padding top/bottom values that work on my
// iPhone for the mobile app. We should spend some time trying to figure out
// values that work in general for WebKit eventually.
globalStyle(`${largeSpacingScaleSelector}[data-engine=webkit]`, {
    vars: assignVars(inlineBackgroundPadding, {
        top: "2px",
        bottom: "2px",
    }),
});

globalStyle(commentClassName, {
    color: "inherit",
    backgroundColor: commentBackgroundColors.light.default,
    // Extend the comment background color to the line height.
    paddingTop: inlineBackgroundPadding.top,
    paddingBottom: inlineBackgroundPadding.bottom,
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

globalStyle(`:is(${fileRowLikeClassName}, ${fileFloatClassName}) ${commentClassName}`, {
    position: "relative",
    display: "grid",
    backgroundColor: "transparent",
    paddingTop: 0,
    paddingBottom: 0,
});

globalStyle(`:is(${fileRowLikeClassName}, ${fileFloatClassName}) ${commentClassName}::after`, {
    content: '""',
    position: "absolute",
    backgroundColor: "transparent",
    // `inset` and `borderRadius` is based on the `<FocusRing>` we render when the
    // file is selected. The focus ring should render on top of the file.
    inset: -4,
    borderRadius: 8,
});

globalStyle(`:is(${fileRowLikeClassName}, ${fileFloatClassName}) > ${commentClassName}::after`, {
    backgroundColor: commentBackgroundColors.light.default,
});

globalStyle(
    `${darkColorSchemeSelector} :is(${fileRowLikeClassName}, ${fileFloatClassName}) > ${commentClassName}::after`,
    {
        backgroundColor: commentBackgroundColors.dark.default,
    },
);

// Use a pointer cursor for comments in a mobile layout since the comment opens
// in a bottom sheet and disables interactivity with the document. Since
// clicking a comment is a more disruptive state shift in mobile layouts, we
// find it useful to give a pointer cursor affordance.
globalStyle(`${narrowRouteLayoutDocClassName} ${commentClassName}`, {
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
    paddingTop: inlineBackgroundPadding.top,
    paddingBottom: inlineBackgroundPadding.bottom,
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
        globalStyle(`${lezerHighlightSelector}`, {
            color: options.color ?? options.lightColor,
        });
    } else {
        globalStyle(`${lezerHighlightSelector}`, {
            color: options.color ?? options.lightColor,
            ...fontStyles[`code-${options.weight}`],
        });

        globalStyle(`${boldClassName} ${lezerHighlightSelector}`, {
            ...fontStyles["code-extra-bold"],
        });
    }

    if (options.darkColor) {
        globalStyle(`${darkColorSchemeSelector} ${lezerHighlightSelector}`, {
            color: options.darkColor,
        });
    }
}

export const commentActiveDynamicCssTemplate = `\
#$containerId .${commentClassName}[data-comment="$commentThreadId"] {background-color: ${
    commentBackgroundColors.light.active
}}
#$containerId .${commentClassName} .${commentClassName}[data-comment="$commentThreadId"] {background-color: ${
    nestedCommentBackgroundColors.light.active
}}
${darkColorSchemeSelector} #$containerId .${commentClassName}[data-comment="$commentThreadId"] {background-color: ${
    commentBackgroundColors.dark.active
}}
${darkColorSchemeSelector} #$containerId .${commentClassName} .${commentClassName}[data-comment="$commentThreadId"] {background-color: ${
    nestedCommentBackgroundColors.dark.active
}}
#$containerId :is(.${fileRowLikeClassName}, .${fileFloatClassName}) .${commentClassName}[data-comment="$commentThreadId"] {background-color: transparent}
#$containerId :is(.${fileRowLikeClassName}, .${fileFloatClassName}) .${commentClassName}[data-comment="$commentThreadId"]::after {background-color: ${
    commentBackgroundColors.light.active
}}
#$containerId :is(.${fileRowLikeClassName}, .${fileFloatClassName}) > .${commentClassName}:not([data-comment="$commentThreadId"]):has(.${commentClassName}[data-comment="$commentThreadId"])::after {background-color: transparent}
${getObjectKeysWithKeyofType(colorByHighlightColor)
    .map(
        highlightColor => `\
#$containerId .${commentClassName}[data-comment="$commentThreadId"] ${
            highlightClassNameByColor[highlightColor]
        } {background-color: ${extrapolateHighlightColorFlippingCommentHighlightColorStackingOrder(
            colors["grey-0"],
            commentBackgroundColors.light.active,
            colors[colorByHighlightColor[highlightColor]],
            highlightOpacity,
        )}}
${darkColorSchemeSelector} #$containerId .${commentClassName}[data-comment="$commentThreadId"] ${
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
    backgroundColorString: string,
    commentHighlightColorString: string,
    highlightColorString: string,
    opacity: number,
) {
    const backgroundColor = parseRawColor(backgroundColorString);
    const commentHighlightColor = parseRawColor(commentHighlightColorString);
    const highlightColor = parseRawColor(highlightColorString);

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
    // Round up to 1.5 on high pixel density screens. Round down to 1 on low pixel
    // density screens.
    textDecorationThickness: 1.49,
    // Remove gaps in links underline in iOS 8+ and Safari 8+.
    // Adobe Spectrum does this and I trust them:
    // https://github.com/adobe/spectrum-css/blob/0623bc93472afe3df13702531e119b62ad5291f2/components/link/index.css#L51-L52
    WebkitTextDecorationSkip: "objects",
    // Turn off contextual alternatives which may look weird in URLs or other
    // machine generated strings. For example, our IDs look weird when you have 3x9
    // randomly generated in the string.
    fontFeatureSettings: '"calt" off',
});

globalStyle(`${headingLevel3ClassName} ${linkClassName}`, {
    textDecorationThickness: 2,
});

globalStyle(`${headingLevel2ClassName} ${linkClassName}`, {
    textDecorationThickness: 2.49,
});

globalStyle(`${headingLevel1ClassName} ${linkClassName}`, {
    textDecorationThickness: 3,
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
    },
});

export const linkLightColorSchemeOverrideClassName = style({
    color: colorSchemeVars["theme-60-const"],
    selectors: {
        [`&${linkClassName}${linkPressedClassName}`]: {
            color: colorSchemeVars["theme-60-const-opacity-60"],
        },
    },
});

export const linkDarkColorSchemeOverrideClassName = style({
    color: colorSchemeVars["theme-40-const"],
    selectors: {
        [`&${linkClassName}${linkPressedClassName}`]: {
            color: colorSchemeVars["theme-40-const-opacity-60"],
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

export const mentionContainerClassName = style({
    paddingTop: inlineBackgroundPadding.top,
    paddingBottom: inlineBackgroundPadding.bottom,
    selectors: {
        "a&": {
            cursor: "pointer",
        },
        "&.ProseMirror-selectednode": {
            backgroundColor: colorSchemeVars["theme-selection"],
        },
    },
});

export const mentionClassName = style({
    position: "relative",
    // We add the same padding top/bottom here as `mentionContainerClassName`.
    // Since `currentAccountMentionClassName` needs this padding. Padding on
    // `display: inline` elements only changes how `background-color` is rendered.
    paddingTop: inlineBackgroundPadding.top,
    paddingBottom: inlineBackgroundPadding.top,
});

export const mentionPressedClassName = style({});

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
            // The +0.5px is necessary for proper positioning given the
            // `position: absolute; left: 1px` we set on the account avatar.
            left: `calc(-1 * ${inlineBackgroundPadding.top} + 0.5px)`,
            right: `calc(-1 * ${inlineBackgroundPadding.top} + 0.5px)`,
            backgroundColor: colorSchemeVars["theme-10"],
            opacity: 0.6,
            borderTopLeftRadius: "0.75em",
            borderBottomLeftRadius: "0.75em",
            borderTopRightRadius: "0.5em",
            borderBottomRightRadius: "0.5em",
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

export const mentionTextClassName = style({
    fontWeight: fontStyles["semi-bold"].fontWeight,
    selectors: {
        [`${mentionPressedClassName} &`]: {opacity: 0.6},
        // Inherit font weight if we are in a container that is bolder than us.
        [`${boldClassName} &`]: {fontWeight: "inherit"},
        [`${headingLevel1ClassName} &`]: {fontWeight: "inherit"},
        [`${headingLevel2ClassName} &`]: {fontWeight: "inherit"},
        [`${headingLevel3ClassName} &`]: {fontWeight: "inherit"},
    },
});

export const mentionIconSizeEm = 1.125;

export const mentionIconContainerClassName = style({
    position: "relative",
});

export const mentionIconClassName = style({
    pointerEvents: "none",
    userSelect: "none",
    position: "absolute",
    // Make sure we don't render over the blinking text cursor which renders at the
    // start of the mention. The text cursor, in Chrome is 1px.
    left: 1,
    bottom: `${1 / fontSizesBySpacingScale["100"].medium.fontSize}em`,
    transformOrigin: "bottom left",
    selectors: {
        [`${mentionPressedClassName} &`]: {opacity: 0.6},
    },
});

export const mentionIconMonospaceSpaceClassName = style({
    // Use our monospace font so the space created by no-break space characters has
    // consistent width that aligns with our monospace font.
    ...fontStyles.code,
});

const mentionIconWithScalingSizeSpacing = "7";
const mentionIconWithScalingSize = spacing[mentionIconWithScalingSizeSpacing];
export {mentionIconWithScalingSizeSpacing as mentionIconWithScalingSize};

export const mentionIconWithScalingClassName = style({});

// Scale the search entity media based on the font size of the parent.
// Unfortunately we can't use em units in `transform: scale()` otherwise we'd
// do that instead of manually enumerating all the different kinds of
// font size.
const mentionIconWithScalingFontSizes: Array<{selector: string | null; fontSize: FontSize}> = [
    {
        selector: null,
        fontSize: paragraphActualFontSize,
    },
    {
        selector: `${headingLevel3ClassName}`,
        fontSize: headingLevel3FontSize.wide,
    },
    {
        selector: `${narrowRouteLayoutDocClassName} ${headingLevel3ClassName}`,
        fontSize: headingLevel3FontSize.narrow,
    },
    {
        selector: `${headingLevel2ClassName}`,
        fontSize: headingLevel2FontSize.wide,
    },
    {
        selector: `${narrowRouteLayoutDocClassName} ${headingLevel2ClassName}`,
        fontSize: headingLevel2FontSize.narrow,
    },
    {
        selector: `${headingLevel1ClassName}`,
        fontSize: headingLevel1FontSize.wide,
    },
    {
        selector: `${narrowRouteLayoutDocClassName} ${headingLevel1ClassName}`,
        fontSize: headingLevel1FontSize.narrow,
    },
];

for (const {selector, fontSize} of mentionIconWithScalingFontSizes) {
    for (const spacingScale of allSpacingScales) {
        globalStyle(
            [
                spacingScale !== "small" ? selectorBySpacingScale[spacingScale] : null,
                selector,
                mentionIconWithScalingClassName,
            ]
                .filter(isNonNullable)
                .join(" "),
            {
                transform: `scale(${
                    (fontSizesBySpacingScale[fontSize][spacingScale].fontSize /
                        convertRemLengthToPx(mentionIconWithScalingSize, spacingScale)) *
                    mentionIconSizeEm
                })`,
            },
        );
    }
}

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
    // `grey-30-translucent` looks a lot nicer over blobs cover art.
    color: colorSchemeVars["grey-30-translucent"],
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
    // `grey-30-translucent` looks a lot nicer over blobs cover art.
    color: colorSchemeVars["grey-30-translucent"],
    position: "absolute",
    // Make sure placeholder is rendered underneath cursor.
    zIndex: -10,
});

const tableOverflowGradientWidthSpacing = "5";
export {tableOverflowGradientWidthSpacing as tableOverflowGradientWidth};
const tableOverflowGradientWidth = spacing[tableOverflowGradientWidthSpacing];

const tableColumnResizeHandleWidthSpacing = "5";
export {tableColumnResizeHandleWidthSpacing as tableColumnResizeHandleWidth};
const tableColumnResizeHandleWidth = spacing[tableColumnResizeHandleWidthSpacing];

const tableColumnResizeHandleIndicatorWidthPx = 3;

const tableColumnResizeHandleHalfWidth: RemLength = `${
    parseRemLength(tableColumnResizeHandleWidth) / 2
}rem`;

// We need more margin bottom than top to render the drop shadow on the
// "Add row" button without clipping.
const tableWrapper2MarginTop = tableColumnResizeHandleHalfWidth;
const tableWrapper2MarginBottom = spacing["6"];

globalStyle(tableWrapperClassName, {
    ...omitObject(blockStyles, ["maxWidth", "marginLeft", "marginRight"]),
    marginTop: standaloneBlockMargin,
    marginBottom: standaloneBlockMargin,
    position: "relative",
    zIndex: "0",
    // The padding top/bottom "freezes" the negative margin of our child
    // `tableWrapper2ClassName` so it doesn't affect the margins of this parent
    // element.
    paddingTop: 1,
    paddingBottom: 1,
});

globalStyle(`${tableWrapperClassName}::before`, {
    content: '""',
    pointerEvents: "none",
    position: "absolute",
    zIndex: "10",
    top: `-${tableWrapper2MarginTop}`,
    bottom: `-${tableWrapper2MarginBottom}`,
    left: `-${tableOverflowGradientWidth}`,
    width: tableOverflowGradientWidth,
    background: `linear-gradient(to right, ${backgroundColorVar}, transparent ${spacing["3"]}, transparent)`,
});

// On mobile, we only have `spacing["3"]` margin. So render the gradient in
// that space even though it covers row grips. Row grips won't be visible since
// you can't hover on mobile.
globalStyle(`${mobilePlatformSelector} ${tableWrapperClassName}::before`, {
    background: `linear-gradient(to right, ${backgroundColorVar}, ${backgroundColorVar} ${spacing["3"]}, transparent)`,
});

globalStyle(`${tableWrapperClassName}::after`, {
    content: '""',
    pointerEvents: "none",
    position: "absolute",
    zIndex: "10",
    top: `-${tableWrapper2MarginTop}`,
    bottom: `-${tableWrapper2MarginBottom}`,
    right: `-${tableOverflowGradientWidth}`,
    width: tableOverflowGradientWidth,
    background: `linear-gradient(to left, ${backgroundColorVar}, transparent ${spacing["3"]}, transparent)`,
});

// On mobile, we only have `spacing["3"]` margin. So render the gradient in
// that space even though it covers row grips. Row grips won't be visible since
// you can't hover on mobile.
globalStyle(`${mobilePlatformSelector} ${tableWrapperClassName}::after`, {
    background: `linear-gradient(to left, ${backgroundColorVar}, ${backgroundColorVar} ${spacing["3"]}, transparent)`,
});

globalStyle(tableWrapper2ClassName, {
    position: "relative",
    zIndex: "0",
    overflowX: "auto",
    overflowY: "hidden",
    overscrollBehaviorX: "contain",
    width: `calc(100% + (${tableOverflowGradientWidth} * 2))`,
    marginLeft: `-${tableOverflowGradientWidth}`,
    marginRight: `-${tableOverflowGradientWidth}`,
    marginTop: `-${tableWrapper2MarginTop}`,
    marginBottom: `-${tableWrapper2MarginBottom}`,
});

globalStyle(tableWrapper3ClassName, {
    width: "100%",
    maxWidth: `calc(${blockMaxWidthVar} + ${addRemLengths(
        tableOverflowGradientWidth,
        tableOverflowGradientWidth,
    )})`,
    margin: "0 auto",
    paddingLeft: tableOverflowGradientWidth,
    paddingRight: tableOverflowGradientWidth,
    paddingTop: tableWrapper2MarginTop,
    paddingBottom: tableWrapper2MarginBottom,
});

globalStyle(`${tableWrapperClassName} table`, {
    pointerEvents: "auto",
    display: "grid",
    position: "relative",
    zIndex: "0",
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
});

globalStyle(`${tableWrapperClassName} tbody`, {
    display: "contents",
});

globalStyle(`${tableWrapperClassName} tr`, {
    display: "contents",
});

globalStyle(`${tableWrapperClassName} td`, {
    display: "block",
    position: "relative",
    minWidth: `${tableColumnMinWidthRem}rem`,
    maxWidth: `${tableColumnMaxWidthRem}rem`,
    padding: `${tableCellPaddingY} ${tableCellPaddingX}`,
    boxShadow: `inset 1px 1px 0 0 ${colorSchemeVars["grey-10"]}, 0 1px 0 0 ${colorSchemeVars["grey-10"]}, 1px 0 0 0 ${colorSchemeVars["grey-10"]}`,
});

globalStyle(`${tableWrapperClassName} td:last-of-type`, {
    // Minor detail: We want the right border on the last column to be inset within
    // the cell instead of outside the cell. That way border-to-border the table
    // width will be exactly equal to the block width at small table sizes down to
    // the pixel.
    boxShadow: `inset 1px 1px 0 0 ${colorSchemeVars["grey-10"]}, 0 1px 0 0 ${colorSchemeVars["grey-10"]}, inset -1px 0 0 0 ${colorSchemeVars["grey-10"]}`,
});

export const tableWithHeaderRowClassName = style({});

// this targets the cells in the header row
globalStyle(`${tableWithHeaderRowClassName} tr:first-of-type td`, {
    color: colorSchemeVars["blue-70"],
    fontWeight: fontStyles["bold"].fontWeight,
    backgroundColor: colorSchemeVars["grey-5"],
});

globalStyle(`${tableWithHeaderRowClassName} tr:first-of-type td ${paragraphClassName}`, {
    fontWeight: fontStyles["bold"].fontWeight,
});

export const tableWithHeaderColumnClassName = style({});

// this targets the cells in the header column (first column in each row)
globalStyle(`${tableWithHeaderColumnClassName} tr td:first-of-type`, {
    color: colorSchemeVars["blue-70"],
    fontWeight: fontStyles["bold"].fontWeight,
    backgroundColor: colorSchemeVars["grey-5"],
});

globalStyle(`${tableWithHeaderColumnClassName} tr td:first-of-type ${paragraphClassName}`, {
    fontWeight: fontStyles["bold"].fontWeight,
});

export const tableCellSelectionClassName = style({
    pointerEvents: "none",
    zIndex: "30",
    position: "absolute",
    width: "calc(100% + 1px)",
    height: "calc(100% + 1px)",
    border: `2px solid ${colorSchemeVars["theme-40-const"]}`,
});

export const tableRightEdgeCellSelectionClassName = style({
    selectors: {
        [`${tableCellSelectionClassName}&`]: {
            width: "100%",
        },
    },
});

export const tableColumnResizeHandleClassName = style({
    zIndex: "40",
    position: "absolute",
    top: 0,
    bottom: -1,
    transform: "translateX(calc(-50% + 0.5px))",
    width: tableColumnResizeHandleWidth,
    pointerEvents: "auto",
    cursor: "col-resize",
    selectors: {
        "&::after": {
            content: '""',
            position: "absolute",
            left: `calc(50% - ${tableColumnResizeHandleIndicatorWidthPx / 2}px)`,
            top: 0,
            bottom: 0,
            width: tableColumnResizeHandleIndicatorWidthPx,
            backgroundColor: colorSchemeVars["theme-40-const"],
        },
    },
});

export const tableRightEdgeColumnResizeHandleClassName = style({
    selectors: {
        [`${tableColumnResizeHandleClassName}&`]: {
            transform: "translateX(calc(-50% - 0.5px))",
        },
    },
});

export const tableRowGripBaseClassName = style({
    zIndex: "50",
    position: "absolute",
    left: "0",
    height: "calc(100% + 1px)",
    transform: "translateX(-50%)",
    width: tableColumnResizeHandleWidth,
    cursor: "grab",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
});

export const tableRowGripClassName = style({});
export const tableRowSelectionGripClassName = style({});

globalStyle(`${tableRowGripBaseClassName} > svg`, {
    pointerEvents: "none",
    width: spacing["4"],
    height: spacing["5"],
    paddingTop: spacing["0.5"],
    paddingBottom: spacing["0.5"],
    backgroundColor: colorSchemeVars["grey-0"],
    fill: colorSchemeVars["grey-70"],
    boxShadow: elevationVars["elevation-20"],
    borderRadius: spacing["0.5"],
});

export const tableColumnGripBaseClassName = style({
    zIndex: "50",
    position: "absolute",
    left: "0",
    width: "calc(100% + 1px)",
    transform: "translateY(-50%)",
    height: tableColumnResizeHandleWidth,
    cursor: "grab",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
});

export const tableRightEdgeColumnGripBaseClassName = style({
    selectors: {
        [`${tableColumnGripBaseClassName}&`]: {
            width: "100%",
        },
    },
});

export const tableColumnGripClassName = style({});
export const tableColumnSelectionGripClassName = style({});

globalStyle(`${tableColumnGripBaseClassName} > svg`, {
    pointerEvents: "none",
    width: spacing["5"],
    height: spacing["4"],
    paddingLeft: spacing["0.5"],
    paddingRight: spacing["0.5"],
    backgroundColor: colorSchemeVars["grey-0"],
    fill: colorSchemeVars["grey-70"],
    boxShadow: elevationVars["elevation-20"],
    borderRadius: spacing["0.5"],
});

export const tableDraggingGripRowDropTargetClassName = style({
    pointerEvents: "none",
    zIndex: "40",
    position: "absolute",
    left: 0,
    right: 0,
    transform: "translateY(calc(-50% + 0.5px))",
    height: tableColumnResizeHandleIndicatorWidthPx,
    backgroundColor: colorSchemeVars["grey-30"],
});

export const tableDraggingGripColumnDropTargetClassName = style({
    pointerEvents: "none",
    zIndex: "40",
    position: "absolute",
    top: 0,
    bottom: -1,
    transform: "translateX(calc(-50% + 0.5px))",
    width: tableColumnResizeHandleIndicatorWidthPx,
    backgroundColor: colorSchemeVars["grey-30"],
});

export const tableAddRowBumperPressedClassName = style({});

export const tableAddRowBumperClassName = style({
    position: "absolute",
    zIndex: "50",
    left: "0",
    right: "0",
    height: tableColumnResizeHandleWidth,
    cursor: "pointer",
    bottom: "0",
    transform: "translateY(50%)",
    selectors: {
        "&::before": {
            pointerEvents: "none",
            content: '""',
            position: "absolute",
            zIndex: "10",
            top: `calc(50% - ${tableColumnResizeHandleIndicatorWidthPx / 2 - 0.5}px)`,
            left: "0",
            right: "0",
            height: tableColumnResizeHandleIndicatorWidthPx,
            backgroundColor: colorSchemeVars["theme-40-const"],
        },
        [`&${tableAddRowBumperPressedClassName}::after`]: {
            pointerEvents: "none",
            content: '""',
            position: "absolute",
            zIndex: "20",
            top: `calc(50% - ${tableColumnResizeHandleIndicatorWidthPx / 2 - 0.5}px)`,
            left: "0",
            right: "0",
            height: tableColumnResizeHandleIndicatorWidthPx,
            backgroundColor: colorSchemeVars["grey-100-const"],
            opacity: buttonPressedOverlayOpacity,
        },
    },
});

export const tableAddRowBumperStickyClassName = style({
    pointerEvents: "none",
    userSelect: "none",
    position: "sticky",
    zIndex: "50",
    width: "100%",
    left: tableOverflowGradientWidth,
    right: tableOverflowGradientWidth,
    height: tableColumnResizeHandleWidth,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
});

export const tableAddRowBumperIconButtonClassName = style({
    overflow: "hidden",
    position: "relative",
    zIndex: "0",
    transform: "translate(0.5px, 0.5px)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    width: spacing["5"],
    height: spacing["5"],
    borderRadius: borderRadius.full,
    backgroundColor: colorSchemeVars["theme-40-const"],
    selectors: {
        [`${tableAddRowBumperClassName}${tableAddRowBumperPressedClassName} &::after`]: {
            content: '""',
            position: "absolute",
            zIndex: "10",
            inset: "0",
            backgroundColor: colorSchemeVars["grey-100-const"],
            opacity: buttonPressedOverlayOpacity,
        },
    },
});

globalStyle(`${tableAddRowBumperIconButtonClassName} > svg`, {
    width: spacing["4"],
    height: spacing["4"],
    fill: colorSchemeVars["grey-0"],
});

function createChildSelectors(child: "first" | "last") {
    const selectors1 = [
        `${listItemClassName}:${child}-child > *:${child}-child`,
        `${listItemClassName}:${child}-child > ${checkListItemContentClassName} > *:${child}-child`,
    ];

    const selectors2 = [
        ...selectors1,
        `${quoteBlockClassName}:${child}-child > *:${child}-child`,
        ...selectors1.map(selector => `${quoteBlockClassName}:${child}-child > ${selector}`),
    ];

    const selectors3 = [
        ...selectors2,
        `${tableWrapperClassName} td > *:${child}-child`,
        ...selectors2.map(selector => `${tableWrapperClassName} td > ${selector}`),
    ];

    return [
        `${docClassName} > *:${child}-child`,
        ...selectors3.map(selector => `${docClassName} > ${selector}`),
    ];
}

// Make sure the first child in our document never has top margin.
createChildSelectors("first").forEach(selector => globalStyle(selector, {marginTop: 0}));

// Make sure the last child in our document never has bottom margin.
createChildSelectors("last").forEach(selector => globalStyle(selector, {marginBottom: 0}));

// Make sure we have even margins around files in a table cell.
globalStyle(`${docClassName} > ${tableWrapperClassName} td > ${fileRowLikeClassName}:first-child`, {
    marginTop: subtractRemLengths(tableCellPaddingX, tableCellPaddingY),
});

// Make sure we have even margins around files in a table cell.
globalStyle(`${docClassName} > ${tableWrapperClassName} td > ${fileRowLikeClassName}:last-child`, {
    marginBottom: subtractRemLengths(tableCellPaddingX, tableCellPaddingY),
});
