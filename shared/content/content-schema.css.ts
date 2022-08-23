import {globalStyle, style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/shared/design/color-scheme.css";
import {fontScale, fontWeights, monospaceFontFamily} from "~/shared/design/fonts";
import {
    mobilePlatformMediaQuery,
    parseRemLengthNumber,
    remPxByPlatform,
    spacing,
} from "~/shared/design/spacing";

const paragraphMargin = spacing["3"];

const headerBottomMargin = spacing["1"];
const headerTopMargin = spacing["8"];

export const docClassName = style({
    color: colorSchemeVars["grey-100"],
    userSelect: "auto",
});

export const paragraphClassName = style({
    ...fontScale.base,
    marginTop: headerBottomMargin,
    marginBottom: paragraphMargin,
});

export const headingLevel1ClassName = style({
    ...fontScale.xl,
    fontWeight: fontWeights.bold,
    marginTop: headerTopMargin,
    marginBottom: headerBottomMargin,
});

export const headingLevel2ClassName = style({
    ...fontScale.lg,
    fontWeight: fontWeights.bold,
    marginTop: headerTopMargin,
    marginBottom: headerBottomMargin,
});

export const headingLevel3ClassName = style({
    ...fontScale.base,
    fontWeight: fontWeights.bold,
    marginTop: headerTopMargin,
    marginBottom: headerBottomMargin,
});

const quoteBlockIndentation = spacing["4"];
const quoteBlockBorderWidth = "0.1875rem";

export const quoteBlockClassName = style({
    paddingLeft:
        parseRemLengthNumber(quoteBlockIndentation) -
        parseRemLengthNumber(quoteBlockBorderWidth) +
        "rem",
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

export const listItemIndentation = spacing["8"];

const bulletListItemBulletSize = spacing["1.5"];

export const listItemClassName = style({
    position: "relative",
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
            left:
                parseRemLengthNumber(listItemIndentation) / 2 -
                parseRemLengthNumber(bulletListItemBulletSize) / 2 +
                "rem",
        },
    },
});

export const orderedListItemClassName = style({
    selectors: {
        "&::before": {
            content: 'attr(data-list-number) "."',
            position: "absolute",
            pointerEvents: "none",
            left: spacing["6"],
            textAlign: "right",
            transform: "translateX(-100%)",
            ...fontScale.base,
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
    left:
        parseRemLengthNumber(listItemIndentation) / 2 -
        (parseRemLengthNumber(checkListItemCheckboxDesktopSize) +
            parseRemLengthNumber(spacing["1"]) * 2) /
            2 +
        "rem",
    borderRadius: "100%",
    padding: spacing["1"],
    cursor: "default",
    userSelect: "none",
    "@media": {
        [mobilePlatformMediaQuery]: {
            top: `-${spacing["0.5"]}`,
            left:
                parseRemLengthNumber(listItemIndentation) / 2 -
                (parseRemLengthNumber(checkListItemCheckboxMobileSize) +
                    parseRemLengthNumber(spacing["1"]) * 2) /
                    2 +
                "rem",
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
    marginTop: headerTopMargin,
    marginBottom: headerTopMargin,
    borderColor: colorSchemeVars["grey-20"],
});

export const boldClassName = style({
    fontWeight: fontWeights.bold,
});

export const italicClassName = style({
    fontStyle: "italic",
});

export const strikeClassName = style({
    textDecorationLine: "line-through",
    textDecorationThickness: 1,
});

export const codeClassName = style({
    fontFamily: monospaceFontFamily,
    fontSize: `${(remPxByPlatform.desktop - 1) / remPxByPlatform.desktop}em`,
    // The line height isn't `fontScale.base.lineHeight` because I've observed that
    // it grows the paragraph container as a whole to a larger height than
    // `fontScale.base.lineHeight`. But 1em seems to inherit the block element's
    // line height?
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

export const linkClassName = style({
    // Links use a pointer cursor. See:
    // https://medium.com/simple-human/buttons-shouldnt-have-a-hand-cursor-b11e99ca374b
    cursor: "pointer",
    color: colorSchemeVars["theme-60"],
    textDecorationLine: "underline",
    textDecorationThickness: 1,
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
