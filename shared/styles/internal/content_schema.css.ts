import {createVar, globalStyle, style} from "@vanilla-extract/css";
import Color from "color";
import {colors} from "~/shared/design/colors.js";
import {colorByHighlightColor} from "~/shared/design/highlight_color.js";
import {
    RemLength,
    addRemLengths,
    mobilePlatformMediaQuery,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {lerp} from "~/shared/helpers/number/lerp.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {borderRadius} from "~/shared/styles/internal/border_radius.css.js";
import {
    CssVarFunction,
    colorSchemeVars,
    darkColorSchemeSelector,
    invertedColors,
} from "~/shared/styles/internal/color_scheme.css.js";
import {
    backgroundFontSizePercentage,
    fontSizes,
    fontStyles,
} from "~/shared/styles/internal/fonts.css.js";
import {
    extrapolateHighlightColor,
    extrapolateHighlightRawColorWithoutBounds,
} from "~/shared/styles/internal/helpers/extrapolate_highlight_color.js";
import {
    RawColor,
    parseRawColor,
    printRawColor,
} from "~/shared/styles/internal/helpers/raw_color.js";
import {inputPlaceholderStyles} from "~/shared/styles/internal/input_placeholder.css.js";
import {peekContainerClassName} from "~/shared/styles/internal/peek.css.js";

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
// - Bold labels in dark mode don't have enough contrast? See
//   https://cyberworlds.dev/s/111hc413nfdxa6vwspnhm3ejsc/documents/wshttcjr5egq22e11k92tq1z7m
// - Checkboxes are misaligned with new line height
// - Documents feel like they need a tighter width and more whitespace (more
//   line height + more space between paragraphs). Thinking about this while
//   writing:
//   https://cyberworlds.dev/s/111hc413nfdxa6vwspnhm3ejsc/documents/r0jzswspqf11nmy1g0zh3n6y4r

const paragraphMargin = spacing["2"];
const headerTopMargin = "1.5em";

export const docClassName = style({
    minHeight: "100%",
    color: colorSchemeVars["grey-text"],
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

const blockMaxWidthWithoutPadding = spacing["160"];
const blockPaddingX = spacing["2"];

export const blockMaxWidth = addRemLengths(
    blockPaddingX,
    blockMaxWidthWithoutPadding,
    blockPaddingX,
);

const blockStyles = {
    width: "100%",
    maxWidth: blockMaxWidth,
    paddingLeft: blockPaddingX,
    paddingRight: blockPaddingX,
    marginLeft: "auto",
    marginRight: "auto",
};

export const desktopTitlePaddingTop = spacing["24"];
export const mobileOrPeekTitlePaddingTop = spacing["12"];

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
            paddingTop: mobileOrPeekTitlePaddingTop,
            minHeight: `calc(${titleFontSize.lineHeight} + ${mobileOrPeekTitlePaddingTop})`,
        },
    },
    selectors: {
        [`${peekContainerClassName} &`]: {
            paddingTop: mobileOrPeekTitlePaddingTop,
            minHeight: `calc(${titleFontSize.lineHeight} + ${mobileOrPeekTitlePaddingTop})`,
        },
    },
});

export const paragraphFontSize: {
    fontSize: string;
    letterSpacing: string;
    lineHeight: RemLength;
} = {
    ...fontSizes["100"],
    // We use an ~1.5x line height for paragraph content.
    lineHeight: "1.25rem",
};

export const paragraphClassName = style({
    ...blockStyles,
    ...fontStyles.normal,
    ...paragraphFontSize,
    // Make sure this node always takes up space even if it is empty. Important
    // when we are rendering placeholders in `<ContentView>`.
    minHeight: paragraphFontSize.lineHeight,
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

export const listItemIndentation = spacing["8"];
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
    paddingLeft: spacing["1"],
    paddingRight: spacing["1"],
    paddingTop: spacing["0.5"],
    paddingBottom: spacing["0.5"],
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
    width: `calc(100% - ${blockPaddingX} * 2)`,
    maxWidth: blockMaxWidthWithoutPadding,
    paddingLeft: 0,
    paddingRight: 0,
    marginTop: headerTopMargin,
    marginBottom: headerTopMargin,
    borderColor: colorSchemeVars["grey-10"],
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
export const codeClassName = style({
    ...fontStyles.code,
    wordWrap: "break-word",
    boxDecorationBreak: "clone",
    borderRadius: borderRadius["base"],
});

export const boldClassName = style({
    ...fontStyles["extra-bold"],
    // Inherit font feature settings from parent instead of turning them off. In a
    // link they should be off (which `fontStyles` does). Outside of a link they
    // should be on.
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
        const color1 = blendColors(invertedColors["grey-0"], commentBackgroundColors.dark.default);
        const color2 = blendColors(invertedColors["grey-0"], backgroundColor);
        return color1 !== color2
            ? extrapolateHighlightColor(color1, color2, Color(backgroundColor).alpha())
            : "transparent";
    }),
};

export const commentClassName = style({
    color: "inherit",
    backgroundColor: commentBackgroundColors.light.default,
    // Extend the comment background color to the line height.
    paddingTop: `${(backgroundFontSizePercentage - 1) / 2}em`,
    paddingBottom: `${(backgroundFontSizePercentage - 1) / 2}em`,
    selectors: {
        "& &": {
            backgroundColor: nestedCommentBackgroundColors.light.default,
        },
        [`${darkColorSchemeSelector} &`]: {
            backgroundColor: commentBackgroundColors.dark.default,
        },
        [`${darkColorSchemeSelector} & &`]: {
            backgroundColor: nestedCommentBackgroundColors.dark.default,
        },
    },
});

const highlightOpacity = 2 / 3;

// We want the highlight color to equal a color in our color scheme. We also
// want the color to be somewhat transparent so if we're highlighting an element/
// with a background shape (like mentions) you can see the background shape
// through the highlight. We accomplish this by extrapolating a color that when
// rendered on top of our background color will equal the target
// highlight color.
export const highlightClassNameByColor = mapObjectValues(colorByHighlightColor, color => {
    return style({
        color: "inherit",
        backgroundColor: extrapolateHighlightColor(
            colors["grey-0"],
            colors[color],
            highlightOpacity,
        ),
        selectors: {
            [`${darkColorSchemeSelector} &`]: {
                backgroundColor: extrapolateHighlightColor(
                    invertedColors["grey-0"],
                    invertedColors[color],
                    highlightOpacity,
                ),
            },
            [`${commentClassName} &`]: {
                backgroundColor:
                    extrapolateHighlightColorFlippingCommentHighlightColorStackingOrder(
                        colors["grey-0"],
                        commentBackgroundColors.light.default,
                        colors[color],
                        highlightOpacity,
                    ),
            },
            [`${darkColorSchemeSelector} ${commentClassName} &`]: {
                backgroundColor:
                    extrapolateHighlightColorFlippingCommentHighlightColorStackingOrder(
                        invertedColors["grey-0"],
                        commentBackgroundColors.dark.default,
                        invertedColors[color],
                        highlightOpacity,
                    ),
            },
        },
    });
});

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
${(Object.keys(colorByHighlightColor) as Array<keyof typeof highlightClassNameByColor>)
    .map(
        highlightColor => `\
#$containerId .${commentClassName}[data-comment="$commentThreadId"] .${
            highlightClassNameByColor[highlightColor]
        } {background-color: ${extrapolateHighlightColorFlippingCommentHighlightColorStackingOrder(
            colors["grey-0"],
            commentBackgroundColors.light.active,
            colors[colorByHighlightColor[highlightColor]],
            highlightOpacity,
        )}}
${darkColorSchemeSelector} #$containerId .${commentClassName}[data-comment="$commentThreadId"] .${
            highlightClassNameByColor[highlightColor]
        } {background-color: ${extrapolateHighlightColorFlippingCommentHighlightColorStackingOrder(
            invertedColors["grey-0"],
            commentBackgroundColors.dark.active,
            invertedColors[colorByHighlightColor[highlightColor]],
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
            borderRadius: borderRadius["base"],
        },
        [`${darkColorSchemeSelector} &`]: {
            color: colorSchemeVars["theme-80"],
        },
        [`${darkColorSchemeSelector} &::after`]: {
            backgroundColor: colorSchemeVars["theme-50"],
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
