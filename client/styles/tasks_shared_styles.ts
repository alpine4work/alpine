import {contentStyles, fontSizes, navigationBarStyles} from "~/client/styles/styles.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    convertRemLengthToPx,
    parseRemLength,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {allSpacingScales} from "~/shared/design/core/spacing_scale.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const taskDetailViewSectionGap = "10";
export const taskDetailViewDenseFieldGap = "5";
export const taskDetailViewTitleFontSize = "300";
export const taskDetailViewFieldLabelFontSize = "75";
export const taskDetailViewCommentSidebarWidth = "96";
export const taskDetailNotesFieldLabelPaddingBottom = "1";
export const taskDetailViewSubtasksFieldLabelPaddingBottom = "2";
export const taskCommentsHeaderNavigationBarSpacing = "10";
export const taskDetailViewStatusButtonSize = {
    desktopWide: "7",
    desktopNarrow: "6",
    mobileNarrow: "7",
} as const;
export const taskDetailViewStatusButtonMobilePaddingTop = "3";
export const taskDetailViewStatusButtonMobilePaddingBottom = "2";

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
    taskRowViewColumnPaddingX,
    taskRowViewFirstColumnExtraPaddingLeft,
);

export const taskRowViewFirstColumnWidth = `min(${addRemLengths(
    taskRowViewColumnWidthRem,
    taskRowViewFirstColumnExtraPaddingLeft,
)}, ${taskRowViewColumnMinViewportWidth} + ${taskRowViewFirstColumnExtraPaddingLeft})`;

export const taskRowViewCollectionsColumnCellOverlayExtraWidth = subtractRemLengths(
    "2.5",
    taskRowViewColumnPaddingX,
);

export const taskRowViewCollectionsColumnCellOverlayWidth = `min(${addRemLengths(
    maxTaskRowViewCollectionsColumnWidth,
    taskRowViewCollectionsColumnCellOverlayExtraWidth,
)}, ${taskRowViewCollectionsColumnMinViewportWidth} + ${taskRowViewCollectionsColumnCellOverlayExtraWidth})`;

export const taskRowViewLastColumnPaddingRight: Spacing = "0";

export const taskRowViewIndentation = {
    desktop: contentStyles.listItemIndentation,
    mobile: "6",
} as const;

export const taskRowViewIndentationRem = mapObjectValues(taskRowViewIndentation, parseRemLength);

export const taskRowTitleInputPaddingYPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        (convertRemLengthToPx(taskRowViewMinHeight, spacingScale) -
            contentStyles.paragraphLineHeightPx[spacingScale]) /
        2,
);

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

export const taskNotepadViewActiveSectionActualMarginBottom = {
    desktop: `max(${spacing[taskNotepadViewActiveSectionMarginBottom]} - var(--safe-area-inset-top, 0px), 0px)`,
    mobile: spacing[taskNotepadViewActiveSectionMarginBottom],
};

export const taskQueryViewCustomizationMobileSectionGap = "4";
export const taskQueryViewCustomizationMobileSectionMarginBottom = "7";
export const taskQueryViewCustomizationMobileSectionHeaderFontSize = "100";
export const taskQueryViewCustomizationMobileSectionHeaderHeight = "6";
export const taskQueryViewCustomizationMobileSectionHeaderMarginBottom = "0.5";
export const taskQueryViewCustomizationMobileSectionOptionHeight = "9";

export const taskQueryViewCustomizationMobileLayoutMarginTop = "1";
export const taskQueryViewCustomizationMobileLayoutMarginBottom = "6";

export const taskCollectionChipHeight: {desktop: Spacing; mobile: Spacing} = {
    desktop: "5",
    mobile: "7",
};
export const taskCollectionChipPaddingY: Spacing = "0.5";
export const taskCollectionChipBorderRadius = "1";

export const taskNotepadViewActiveSectionMinHeight = {
    desktop: addRemLengths(
        taskNotepadViewActiveSectionMarginTop.desktop,
        fontSizes[taskNotepadViewActiveSectionTitleFontSize.desktop].lineHeight,
        taskNotepadViewActiveSectionPaddingY,
        taskCardViewMinHeight,
        taskNotepadViewActiveSectionPaddingY,
        taskNotepadViewActiveSectionMarginBottom,
    ),
    mobile: addRemLengths(
        taskNotepadViewActiveSectionMarginTop.mobile,
        fontSizes[taskNotepadViewActiveSectionTitleFontSize.mobile].lineHeight,
        taskNotepadViewActiveSectionPaddingY,
        taskCardViewMinHeight,
        taskNotepadViewActiveSectionPaddingY,
        taskNotepadViewActiveSectionMarginBottom,
    ),
};

export const taskNotepadViewPaginatorHeight = {desktop: "6", mobile: "7"} as const;

export const newTaskCollectionNamePlaceholder = "New collection";
export const defaultTaskQueryViewName = "New view";

export const taskRowViewStatusButtonWidth = {desktop: "6", mobile: "7"} as const;
export const taskRowViewStatusButtonWidthRem = mapObjectValues(
    taskRowViewStatusButtonWidth,
    parseRemLength,
);

export const taskRowViewExpandButtonWidth = "5";
export const taskRowViewExpandButtonWidthRem = parseRemLength(taskRowViewExpandButtonWidth);

export const taskRowViewDragHandleWidth = "5";
export const taskRowViewDragHandleWidthRem = parseRemLength(taskRowViewDragHandleWidth);

export const taskQueryFilterEditorDesktopHeight = "6";

export const taskQueryViewCustomizationBarDesktopMarginY: RemLength = `${
    (navigationBarStyles.navigationBarHeightRem -
        parseRemLength(taskQueryFilterEditorDesktopHeight)) /
    2
}rem`;
