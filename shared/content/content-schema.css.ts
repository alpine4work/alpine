import {globalStyle, style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/shared/design/color-scheme.css";
import {fontScale, fontWeights} from "~/shared/design/fonts";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing";

const paragraphMargin = spacing["3"];

const headerBottomMargin = spacing["2"];
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

export const listItemIndentation = spacing["6"];

const quoteBlockBorderWidth = "0.1875rem";
const bulletListItemBulletSize = "0.3125rem";

export const quoteBlockClassName = style({
    // The quote block border is aligned with the list item bullet.
    marginLeft:
        parseRemLengthNumber(spacing["0.5"]) +
        (parseRemLengthNumber(bulletListItemBulletSize) -
            parseRemLengthNumber(quoteBlockBorderWidth)) /
            2 +
        "rem",
    paddingLeft:
        parseRemLengthNumber(listItemIndentation) -
        parseRemLengthNumber(spacing["0.5"]) -
        parseRemLengthNumber(bulletListItemBulletSize) +
        "rem",
    borderLeftWidth: quoteBlockBorderWidth,
    borderColor: colorSchemeVars["grey-10"],
    color: colorSchemeVars["grey-60"],
});

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
            left: spacing["0.5"],
        },
    },
});

export const orderedListItemClassName = style({
    selectors: {
        "&::before": {
            content: '"1."',
            position: "absolute",
            pointerEvents: "none",
            left: 0,
            ...fontScale.base,
        },
    },
});

// Make sure the first child in our document never has top margin.
globalStyle(`${docClassName} > *:first-child`, {marginTop: 0});
globalStyle(`${docClassName} > ${quoteBlockClassName}:first-child > *:first-child`, {marginTop: 0});
globalStyle(`${docClassName} > ${listItemClassName}:first-child > *:first-child`, {marginTop: 0});

// Make sure the last child in our document never has bottom margin.
globalStyle(`${docClassName} > *:last-child`, {marginBottom: 0});
globalStyle(`${docClassName} > ${quoteBlockClassName}:last-child > *:last-child`, {
    marginBottom: 0,
});
globalStyle(`${docClassName} > ${listItemClassName}:last-child > *:last-child`, {marginBottom: 0});
