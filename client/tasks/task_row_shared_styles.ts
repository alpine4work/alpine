import {
    RemLength,
    Spacing,
    addRemLengths,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";

export const taskRowViewMinHeight: Spacing = "10";

export const taskRowViewPaddingX: {
    desktop: Spacing;
    mobile: Spacing;
} = {
    desktop: "5",
    mobile: "4",
};

export const taskRowViewPaddingXRem: {
    desktop: number;
    mobile: number;
} = {
    desktop: parseRemLengthNumber(spacing[taskRowViewPaddingX.desktop]),
    mobile: parseRemLengthNumber(spacing[taskRowViewPaddingX.mobile]),
};

export const taskRowViewColumnWidth: Spacing = "32";
export const taskRowViewCollectionsColumnWidth: Spacing = "48";
export const taskRowViewColumnPaddingX = "1.5" satisfies Spacing;

export const taskRowViewFirstColumnExtraPaddingLeft = spacing["6"];

export const taskRowViewFirstColumnPaddingLeft: RemLength = addRemLengths(
    spacing[taskRowViewColumnPaddingX],
    taskRowViewFirstColumnExtraPaddingLeft,
);

export const taskRowViewFirstColumnWidth: RemLength = addRemLengths(
    spacing["32"],
    taskRowViewFirstColumnExtraPaddingLeft,
);

export const taskRowViewLastColumnPaddingRight: Spacing = "0";

export const desktopTaskRowViewIndentation = contentSchemaStyles.listItemIndentation;
export const mobileTaskRowViewIndentation = spacing["6"];

export const desktopTaskRowViewIndentationRem = parseRemLengthNumber(desktopTaskRowViewIndentation);
export const mobileTaskRowViewIndentationRem = parseRemLengthNumber(mobileTaskRowViewIndentation);
