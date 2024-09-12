import {contentStyles} from "~/client/styles/styles.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    parseRemLengthNumber,
    spacing,
    subtractRemLengths,
} from "~/shared/design/spacing.js";

export const taskDetailViewMaxWidth = "160";
export const taskDetailViewSectionGap = "10";
export const taskDetailViewDenseFieldGap = "5";
export const taskDetailViewTitleFontSize = "300";
export const taskDetailViewFieldLabelFontSize = "75";
export const taskDetailViewCommentSidebarWidth = "96";
export const taskDetailNotesFieldLabelPaddingBottom = "1";
export const taskDetailViewSubtasksFieldLabelPaddingBottom = "2";
export const taskCommentsHeaderNavigationBarSpacing = "10";
export const desktopTaskDetailViewStatusButtonSize = "6";
export const mobileTaskDetailViewStatusButtonSize = "7";
export const mobileTaskDetailViewStatusButtonPaddingTop = "3";
export const mobileTaskDetailViewStatusButtonPaddingBottom = "2";
export const desktopTaskDetailViewNavigationBarSpacerMarginBottom = "-1";

export const taskGridViewColumnHeaderHeight = "5";

// It takes 2px to render the bottom borders on our column header. 1px for the
// border itself and 1px below that to avoid covering the first row's bottom
// border. We don't want to take those 2px from the column header's height so
// we need to add back some extra padding bottom height.
export const taskGridViewColumnHeaderExtraPaddingBottomPx = 2;

export const taskRowViewMinHeight = "10";

const taskRowViewColumnWidthRem = spacing["32"];
const taskRowViewColumnMinViewportWidth = "10vw";

export const maxTaskRowViewCollectionsColumnWidth = "48";
const taskRowViewCollectionsColumnMinViewportWidth = "15vw";

// Minimum width is in viewport units instead of percentages so it's consistent
// regardless of the container element we use this width in.
export const taskRowViewColumnWidth = `min(${taskRowViewColumnWidthRem}, ${taskRowViewColumnMinViewportWidth})`;
export const taskRowViewCollectionsColumnWidth = `min(${spacing[maxTaskRowViewCollectionsColumnWidth]}, ${taskRowViewCollectionsColumnMinViewportWidth})`;
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
    spacing[maxTaskRowViewCollectionsColumnWidth],
    taskRowViewCollectionsColumnCellOverlayExtraWidth,
)}, ${taskRowViewCollectionsColumnMinViewportWidth} + ${taskRowViewCollectionsColumnCellOverlayExtraWidth})`;

export const taskRowViewLastColumnPaddingRight: Spacing = "0";

export const desktopTaskRowViewIndentation = spacing[contentStyles.listItemIndentation];
export const mobileTaskRowViewIndentation = spacing["6"];

export const desktopTaskRowViewIndentationRem = parseRemLengthNumber(desktopTaskRowViewIndentation);
export const mobileTaskRowViewIndentationRem = parseRemLengthNumber(mobileTaskRowViewIndentation);

export const taskNotepadViewActiveSectionCardGap: Spacing = "3";

// Height of a card with an extra field (e.g. assignee) and two lines of text
// in the title.
export const taskNotepadViewActiveSectionInstructionalPlaceholderCardHeight = "6.5rem";

export const taskCardViewMinHeight = "5.375rem";
export const taskCardViewMaxWidth = "96";

export const taskNotepadViewActiveSectionMarginTop = {desktop: "4", mobile: "2"} as const;
export const taskNotepadViewActiveSectionMarginBottom = "8";
export const taskNotepadViewActiveSectionPaddingY = "2";
export const taskNotepadViewActiveSectionTitleFontSize = {desktop: "200", mobile: "100"} as const;

export const desktopTaskNotepadViewActiveSectionMarginBottom = `max(${spacing[taskNotepadViewActiveSectionMarginBottom]} - var(--safe-area-inset-top, 0px), 0px)`;
export const mobileTaskNotepadViewActiveSectionMarginBottom =
    spacing[taskNotepadViewActiveSectionMarginBottom];

export const taskQueryViewCustomizationMobileSectionGap = "4";
export const taskQueryViewCustomizationMobileSectionMarginBottom = "7";
export const taskQueryViewCustomizationMobileSectionHeaderFontSize = "100";
export const taskQueryViewCustomizationMobileSectionHeaderHeight = "6";
export const taskQueryViewCustomizationMobileSectionHeaderMarginBottom = "0.5";
export const taskQueryViewCustomizationMobileSectionOptionHeight = "9";

export const taskQueryViewCustomizationMobileLayoutMarginTop = "1";
export const taskQueryViewCustomizationMobileLayoutMarginBottom = "6";
