import {RemLength, Spacing, addRemLengths, spacing} from "~/shared/design/spacing";

export const taskRowViewMinHeight: Spacing = "9";

export const taskRowViewColumnWidth: Spacing = "32";
export const taskRowViewCollectionsColumnWidth: Spacing = "48";
export const taskRowViewColumnPaddingX: Spacing = "1.5";

export const taskRowViewFirstColumnPaddingLeft: Spacing = "6";
export const taskRowViewFirstColumnWidth: RemLength = addRemLengths(
    spacing["32"],
    spacing["1.5"],
    spacing["3"],
);
