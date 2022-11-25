import {createVar, globalStyle, style} from "@vanilla-extract/css";
import {colorByHighlightColor} from "~/shared/content/highlight_color";
import {
    mobilePlatformMediaQuery,
    parseRemLengthNumber,
    remPxByPlatform,
    spacing,
} from "~/shared/design/spacing";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values";
import {CssVarFunction, colorSchemeVars} from "~/shared/styles/internal/color_scheme.css";
import {typographySize, typographyStyle} from "~/shared/styles/internal/typography.css";

const paragraphMargin = spacing["3"];
const headerTopMargin = spacing["6"];

export const docClassName = style({
    position: "relative",
    minHeight: "100%",
    color: colorSchemeVars["grey-100"],
    userSelect: "auto",
    cursor: "text",
});

const blockStyles = {
    width: "100%",
    maxWidth: spacing["192"],
    marginLeft: "auto",
    marginRight: "auto",
};

export const titlePaddingTop = spacing["24"];

export const titleClassName = style([
    "contentSchemaTitle",
    {
        ...blockStyles,
        ...typographyStyle.primarySemiBold,
        ...typographySize.heading2,
        paddingTop: titlePaddingTop,
        marginBottom: paragraphMargin,
        // backgroundImage: "var(--blob-factory-text-fill-bg-image)",
        // backgroundSize: "var(--blob-factory-text-fill-bg-size)",
        // backgroundPosition: "var(--blob-factory-text-fill-bg-position)",
        // backgroundClip: "var(--blob-factory-text-fill-bg-clip)",
        // WebkitBackgroundClip: "var(--blob-factory-text-fill-bg-clip)",
        // color: "var(--blob-factory-text-fill-text-color)",
    },
]);

export const paragraphClassName = style({
    ...blockStyles,
    ...typographyStyle.primary,
    ...typographySize.body,
    marginTop: paragraphMargin,
    marginBottom: paragraphMargin,
});

export const headingLevel1ClassName = style({
    ...blockStyles,
    ...typographyStyle.primarySemiBold,
    ...typographySize.heading3,
    marginTop: headerTopMargin,
    marginBottom: paragraphMargin,
});

export const headingLevel2ClassName = style({
    ...blockStyles,
    ...typographyStyle.primarySemiBold,
    ...typographySize.heading4,
    marginTop: headerTopMargin,
    marginBottom: paragraphMargin,
});

export const headingLevel3ClassName = style({
    ...blockStyles,
    ...typographyStyle.primarySemiBold,
    ...typographySize.heading5,
    marginTop: headerTopMargin,
    marginBottom: paragraphMargin,
});

const quoteBlockIndentation = spacing["4"];
const quoteBlockBorderWidth = "0.1875rem";

export const quoteBlockClassName = style({
    ...blockStyles,
    paddingLeft: `${
        parseRemLengthNumber(quoteBlockIndentation) - parseRemLengthNumber(quoteBlockBorderWidth)
    }rem`,
    borderLeftWidth: quoteBlockBorderWidth,
    borderColor: colorSchemeVars["grey-10"],
    color: colorSchemeVars["grey-60"],
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
            top: "0.625rem",
            left: `calc((${listItemIndentationVar} * ${listItemIndentation}) + ${
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
            left: `calc((${listItemIndentationVar} * ${listItemIndentation}) + ${spacing["6"]})`,
            textAlign: "right",
            transform: "translateX(-100%)",
            ...typographySize.body,
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
    left: `calc((${listItemIndentationVar} * ${listItemIndentation}) + ${
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
            left: `calc((${listItemIndentationVar} * ${listItemIndentation}) + ${
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
    marginTop: headerTopMargin,
    marginBottom: headerTopMargin,
    borderColor: colorSchemeVars["grey-20"],
});

export const codeClassName = style({
    ...typographyStyle.code,
    fontSize: `${(remPxByPlatform.desktop - 1) / remPxByPlatform.desktop}em`,
    // The line height isn't `typographySize.base.lineHeight` because I've
    // observed that it grows the paragraph container as a whole to a larger height
    // than `typographySize.base.lineHeight`. But 1em seems to inherit the block
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
    ...typographyStyle.primaryBold,
    selectors: {
        [`${codeClassName} &`]: {
            ...typographyStyle.codeBold,
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
    // Links use a pointer cursor. See:
    // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
    cursor: "pointer",
    color: colorSchemeVars["theme-60"],
    textDecorationLine: "underline",
    textDecorationThickness: 1,
    // Remove gaps in links underline in iOS 8+ and Safari 8+.
    // Adobe Spectrum does this and I trust them:
    // https://github.com/adobe/spectrum-css/blob/0623bc93472afe3df13702531e119b62ad5291f2/components/link/index.css#L51-L52
    WebkitTextDecorationSkip: "objects",
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
