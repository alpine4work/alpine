import {RemLength, Spacing, addRemLengths, spacing} from "~/shared/design/spacing";

export const taskRowViewMinHeight: Spacing = "9";

export const taskRowViewColumnWidth: Spacing = "32";
export const taskRowViewCollectionsColumnWidth: Spacing = "48";
export const taskRowViewColumnPaddingX = "1.5" satisfies Spacing;

const taskRowViewFirstColumnExtraPaddingLeft = spacing["6"];

export const taskRowViewFirstColumnPaddingLeft: RemLength = addRemLengths(
    spacing[taskRowViewColumnPaddingX],
    taskRowViewFirstColumnExtraPaddingLeft,
);

export const taskRowViewFirstColumnWidth: RemLength = addRemLengths(
    spacing["32"],
    taskRowViewFirstColumnExtraPaddingLeft,
);

export const taskRowViewLastColumnPaddingRight: Spacing = "0";
