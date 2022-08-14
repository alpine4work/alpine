import {globalStyle, style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/shared/design/color-scheme.css";
import {fontScale, fontWeights} from "~/shared/design/fonts";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing";

const paragraphMargin = spacing["3"];

const headerBottomMargin = spacing["1"];
const headerTopMargin = spacing["8"];

export const docClassName = style({
    color: colorSchemeVars["grey-100"],
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

export const quoteBlockIndentation = spacing["5"];

const quoteBlockBorderWidth = "0.1875rem";

export const quoteBlockClassName = style({
    paddingLeft:
        parseRemLengthNumber(quoteBlockIndentation) -
        parseRemLengthNumber(quoteBlockBorderWidth) +
        "rem",
    borderLeftWidth: quoteBlockBorderWidth,
    borderColor: colorSchemeVars["grey-10"],
    color: colorSchemeVars["grey-70"],
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

const bulletListItemBulletSize = "0.3125rem";

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

// Make sure the first child in our document never has top margin.
globalStyle(`${docClassName} > *:first-child`, {
    marginTop: 0,
});
globalStyle(`${docClassName} > ${quoteBlockClassName}:first-child > *:first-child`, {
    marginTop: 0,
});
globalStyle(`${docClassName} > ${listItemClassName}:first-child > *:first-child`, {
    marginTop: 0,
});

// Make sure the last child in our document never has bottom margin.
globalStyle(`${docClassName} > *:last-child`, {
    marginBottom: 0,
});
globalStyle(`${docClassName} > ${quoteBlockClassName}:last-child > *:last-child`, {
    marginBottom: 0,
});
globalStyle(`${docClassName} > ${listItemClassName}:last-child > *:last-child`, {
    marginBottom: 0,
});
