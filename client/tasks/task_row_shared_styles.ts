import {
    RemLength,
    Spacing,
    addRemLengths,
    parseRemLengthNumber,
    spacing,
    subtractRemLengths,
} from "~/shared/design/spacing.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";

export const taskRowViewMinHeight: Spacing = "10";

const taskRowViewColumnWidthRem = spacing["32"];
const taskRowViewColumnMinViewportWidth = "10vw";

const taskRowViewCollectionsColumnWidthRem = spacing["48"];
const taskRowViewCollectionsColumnMinViewportWidth = "15vw";

// Minimum width is in viewport units instead of percentages so it's consistent
// regardless of the container element we use this width in.
export const taskRowViewColumnWidth = `min(${taskRowViewColumnWidthRem}, ${taskRowViewColumnMinViewportWidth})`;
export const taskRowViewCollectionsColumnWidth = `min(${taskRowViewCollectionsColumnWidthRem}, ${taskRowViewCollectionsColumnMinViewportWidth})`;
export const taskRowViewColumnPaddingX = "1.5" satisfies Spacing;

export const taskRowViewFirstColumnExtraPaddingLeft = spacing["6"];

export const taskRowViewFirstColumnPaddingLeft: RemLength = addRemLengths(
    spacing[taskRowViewColumnPaddingX],
    taskRowViewFirstColumnExtraPaddingLeft,
);

export const taskRowViewFirstColumnWidth = `min(${addRemLengths(
    taskRowViewColumnWidthRem,
    taskRowViewFirstColumnExtraPaddingLeft,
)}, ${taskRowViewColumnMinViewportWidth} + ${taskRowViewFirstColumnExtraPaddingLeft})`;

const taskRowViewCollectionsColumnCellOverlayExtraWidth = subtractRemLengths(
    spacing["2.5"],
    spacing[taskRowViewColumnPaddingX],
);

export const taskRowViewCollectionsColumnCellOverlayWidth = `min(${addRemLengths(
    taskRowViewCollectionsColumnWidthRem,
    taskRowViewCollectionsColumnCellOverlayExtraWidth,
)}, ${taskRowViewCollectionsColumnMinViewportWidth} + ${taskRowViewCollectionsColumnCellOverlayExtraWidth})`;

export const taskRowViewLastColumnPaddingRight: Spacing = "0";

export const desktopTaskRowViewIndentation = contentSchemaStyles.listItemIndentation;
export const mobileTaskRowViewIndentation = spacing["6"];

export const desktopTaskRowViewIndentationRem = parseRemLengthNumber(desktopTaskRowViewIndentation);
export const mobileTaskRowViewIndentationRem = parseRemLengthNumber(mobileTaskRowViewIndentation);
