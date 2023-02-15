import {createVar, globalStyle, style} from "@vanilla-extract/css";
import {colorByHighlightColor} from "~/shared/design/highlight_color";
import {
    RemLength,
    mobilePlatformMediaQuery,
    parseRemLengthNumber,
    remPxByPlatform,
    spacing,
} from "~/shared/design/spacing";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values";
import {CssVarFunction, colorSchemeVars} from "~/shared/styles/internal/color_scheme.css";
import {fontSizes, fontStyles} from "~/shared/styles/internal/fonts.css";
import {inputPlaceholderColor} from "~/shared/styles/internal/input_placeholder_color.css";

// TODO(calebmer): Running list of style tweaks to explore.
//
// - Link underline is too close to the link
// - Link dark mode color too dark (light mode color feels right?)
// - Single line bullets have so much margin between them
// - Blobs still a little too overpowering of content
// - Blobs that are just on the cusp of merging or not merging look weird to me? idk
// - Selection style bar is a little too far from text selection
// - Is bold text too bold?
// - Bullet in bulleted list is a little low
// - Pressing a link should change the style of the link somehow as feedback.
//   At least on mobile
// - When there is a spellcheck squiggle on a link with an underline, the
//   underline disappears.
// - Strikethrough on h1 feels too thin relative to text
// - On mobile, does hitting enter to create a new line capitalize? With
//   auto-capitalization on and off.
// - Yasmin's suggestions

const paragraphMargin = spacing["2"];
const headerTopMargin = "1.5em";

export const docClassName = style({
    minHeight: "100%",
    color: colorSchemeVars["grey-text"],
    userSelect: "text",
    // Create a new z-index stacking context.
    position: "relative",
    zIndex: 0,
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

const blockWidth = spacing["192"];
const blockPaddingX = spacing["2"];

const blockStyles = {
    width: "100%",
    maxWidth: `calc(${blockWidth} + ${blockPaddingX} * 2)`,
    paddingLeft: blockPaddingX,
    paddingRight: blockPaddingX,
    marginLeft: "auto",
    marginRight: "auto",
};

export const desktopTitlePaddingTop = spacing["24"];
export const mobileTitlePaddingTop = spacing["12"];

export const titleFontSize = fontSizes["800"];

export const titleClassName = style({
    ...blockStyles,
    ...fontStyles.bold,
    ...titleFontSize,
    paddingTop: desktopTitlePaddingTop,
    // Make sure this node always takes up space even if it is empty. Important
    // when we are rendering placeholders in `<ContentView>`.
    minHeight: `calc(${titleFontSize.lineHeight} + ${desktopTitlePaddingTop})`,
    marginBottom: paragraphMargin,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
    "@media": {
        [mobilePlatformMediaQuery]: {
            paddingTop: mobileTitlePaddingTop,
            minHeight: `calc(${titleFontSize.lineHeight} + ${mobileTitlePaddingTop})`,
        },
    },
});

export const paragraphFontSize: {
    fontSize: string;
    letterSpacing: string;
    lineHeight: RemLength;
} = {
    ...fontSizes["100"],
    // We use a 1.5x line height for paragraph content.
    lineHeight: "1.25rem",
};

export const paragraphClassName = style({
    ...blockStyles,
    ...fontStyles.normal,
    ...paragraphFontSize,
    // Make sure this node always takes up space even if it is empty. Important
    // when we are rendering placeholders in `<ContentView>`.
    minHeight: "1.25rem",
    marginTop: paragraphMargin,
    marginBottom: paragraphMargin,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

export const headingLevel1FontSize = fontSizes["500"];

export const headingLevel1ClassName = style({
    ...blockStyles,
    ...fontStyles.bold,
    ...headingLevel1FontSize,
    marginTop: headerTopMargin,
    marginBottom: paragraphMargin,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

export const headingLevel2FontSize = fontSizes["400"];

export const headingLevel2ClassName = style({
    ...blockStyles,
    ...fontStyles.bold,
    ...headingLevel2FontSize,
    marginTop: headerTopMargin,
    marginBottom: paragraphMargin,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

export const headingLevel3FontSize = fontSizes["300"];

export const headingLevel3ClassName = style({
    ...blockStyles,
    ...fontStyles.bold,
    ...headingLevel3FontSize,
    marginTop: headerTopMargin,
    marginBottom: paragraphMargin,
    // Allow contextual alternate glyphs in regular text content.
    fontFeatureSettings: '"calt" on',
});

const quoteBlockIndentation = spacing["4"];
const quoteBlockBorderWidth = "0.1875rem";

export const quoteBlockClassName = style({
    ...blockStyles,
    position: "relative",
    paddingLeft: quoteBlockIndentation,
    color: colorSchemeVars["grey-60"],
    selectors: {
        "&::before": {
            content: '""',
            position: "absolute",
            top: "0",
            bottom: "0",
            left: blockPaddingX,
            width: quoteBlockBorderWidth,
            backgroundColor: colorSchemeVars["grey-10"],
            pointerEvents: "none",
        },
    },
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

const listItemIndentation = spacing["8"];
export const listItemIndentationVar: CssVarFunction = createVar();

const bulletListItemBulletSize = spacing["1.5"];

export const listItemClassName = style({
    ...blockStyles,
    position: "relative",
    paddingLeft: `calc((${listItemIndentationVar} + 1) * ${listItemIndentation})`,
});

export const bulletListItemClassName = style({
    selectors: {
        "&::before": {
            content: '""',
            position: "absolute",
            backgroundColor: "currentColor",
            borderRadius: "50%",
            pointerEvents: "none",
            width: bulletListItemBulletSize,
            height: bulletListItemBulletSize,
            top: "0.5rem",
            left: `calc(${blockPaddingX} + (${listItemIndentationVar} * ${listItemIndentation}) + ${
                parseRemLengthNumber(listItemIndentation) / 2 -
                parseRemLengthNumber(bulletListItemBulletSize) / 2
            }rem)`,
        },
    },
});

export const orderedListItemClassName = style({
    selectors: {
        "&::before": {
            content: 'attr(data-list-number) "."',
            position: "absolute",
            pointerEvents: "none",
            top: 0,
            left: `calc(${blockPaddingX} + (${listItemIndentationVar} * ${listItemIndentation}) + ${spacing["6"]})`,
            textAlign: "right",
            transform: "translateX(-100%)",
            ...paragraphFontSize,
            fontVariantNumeric: "tabular-nums",
        },
    },
});

const checkListItemCheckboxDesktopSize = spacing["4"];
const checkListItemCheckboxMobileSize = spacing["5"];

export const checkListItemCheckedClassName = style({
    color: colorSchemeVars["grey-60"],
});

export const checkListItemContentClassName = style({});

// The checkbox is a little small. Add some extra hit area to make it easier
// to click.
export const checkListItemCheckboxContainerClassName = style({
    position: "absolute",
    top: 0,
    left: `calc(${blockPaddingX} + (${listItemIndentationVar} * ${listItemIndentation}) + ${
        parseRemLengthNumber(listItemIndentation) / 2 -
        (parseRemLengthNumber(checkListItemCheckboxDesktopSize) +
            parseRemLengthNumber(spacing["1"]) * 2) /
            2
    }rem)`,
    borderRadius: "100%",
    padding: spacing["1"],
    cursor: "default",
    userSelect: "none",
    "@media": {
        [mobilePlatformMediaQuery]: {
            top: `-${spacing["0.5"]}`,
            left: `calc(${blockPaddingX} + (${listItemIndentationVar} * ${listItemIndentation}) + ${
                parseRemLengthNumber(listItemIndentation) / 2 -
                (parseRemLengthNumber(checkListItemCheckboxMobileSize) +
                    parseRemLengthNumber(spacing["1"]) * 2) /
                    2
            }rem)`,
        },
    },
});

// TODO(calebmer): Come back to this when we design task check boxes. Also add
// a nice animation or something when checked. I'm a little skeptical a circle
// is the right design. Checkboxes are typically squares. See:
// http://danieldelaney.net/checkboxes/
//
// TODO(calebmer): We also need a disabled style for this checkbox when the
// checkbox is read-only.
export const checkListItemCheckboxClassName = style({
    borderRadius: "100%",
    width: checkListItemCheckboxDesktopSize,
    height: checkListItemCheckboxDesktopSize,
    padding: spacing["0.5"],
    backgroundColor: "transparent",
    color: colorSchemeVars["grey-70"],
    borderWidth: 1,
    borderColor: colorSchemeVars["grey-70"],
    selectors: {
        [`${checkListItemCheckedClassName} &`]: {
            backgroundColor: colorSchemeVars["theme-50-const"],
            color: colorSchemeVars["grey-0-const"],
            borderColor: colorSchemeVars["theme-50-const"],
        },
    },
    "@media": {
        [mobilePlatformMediaQuery]: {
            width: checkListItemCheckboxMobileSize,
            height: checkListItemCheckboxMobileSize,
            padding: spacing["1"],
        },
    },
});

export const checkListItemCheckboxPressedClassName = style({
    backgroundColor: colorSchemeVars["grey-10"],
    color: colorSchemeVars["grey-90"],
    borderColor: colorSchemeVars["grey-90"],
    selectors: {
        [`${checkListItemCheckedClassName} &`]: {
            backgroundColor: colorSchemeVars["theme-60-const"],
            color: colorSchemeVars["grey-0-const"],
            borderColor: colorSchemeVars["theme-60-const"],
        },
    },
});

export const dividerClassName = style({
    ...blockStyles,
    width: blockWidth,
    paddingLeft: 0,
    paddingRight: 0,
    marginTop: headerTopMargin,
    marginBottom: headerTopMargin,
    borderColor: colorSchemeVars["grey-20"],
});

export const codeClassName = style({
    ...fontStyles.code,
    fontSize: `${(remPxByPlatform.desktop - 1) / remPxByPlatform.desktop}em`,
    // The line height isn't `fontSize.base.lineHeight` because I've
    // observed that it grows the paragraph container as a whole to a larger height
    // than `fontSize.base.lineHeight`. But 1em seems to inherit the block
    // element's line height?
    lineHeight: "1em",
    backgroundColor: colorSchemeVars["grey-5"],
    wordWrap: "break-word",
    boxDecorationBreak: "clone",
    paddingTop: spacing["0.5"],
    paddingBottom: spacing["0.5"],
    paddingLeft: spacing["1"],
    paddingRight: spacing["1"],
    borderRadius: spacing["1"],
});

export const boldClassName = style({
    ...fontStyles["extra-bold"],
    // Inherit font feature settings from parent instead of turning them off. In a
    // link they should be off. Outside of a link they should be on.
    fontFeatureSettings: "inherit",
    selectors: {
        [`${codeClassName} &`]: {
            ...fontStyles["code-bold"],
        },
    },
});

export const italicClassName = style({
    fontStyle: "italic",
});

export const strikeClassName = style({
    textDecorationLine: "line-through",
    textDecorationThickness: 1,
});

export const highlightClassNameByColor = mapObjectValues(colorByHighlightColor, color =>
    style({
        color: "inherit",
        backgroundColor: colorSchemeVars[color],
    }),
);

export const linkClassName = style({
    color: colorSchemeVars["theme-60"],
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
    selectors: {
        // Inert links use a `<span>` element.
        "a&": {
            // Links use a pointer cursor. See:
            // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
            cursor: "pointer",
        },
    },
});

// Make sure the first child in our document never has top margin.
const firstChildSelectors = [
    `${docClassName} > *:first-child`,
    `${docClassName} > ${quoteBlockClassName}:first-child > *:first-child`,
    `${docClassName} > ${listItemClassName}:first-child > *:first-child`,
    `${docClassName} > ${listItemClassName}:first-child > ${checkListItemContentClassName} > *:first-child`,
];
firstChildSelectors.forEach(selector => globalStyle(selector, {marginTop: 0}));

// Make sure the last child in our document never has bottom margin.
const lastChildSelectors = [
    `${docClassName} > *:last-child`,
    `${docClassName} > ${quoteBlockClassName}:last-child > *:last-child`,
    `${docClassName} > ${listItemClassName}:last-child > *:last-child`,
    `${docClassName} > ${listItemClassName}:last-child > ${checkListItemContentClassName} > *:last-child`,
];
lastChildSelectors.forEach(selector => globalStyle(selector, {marginBottom: 0}));

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
