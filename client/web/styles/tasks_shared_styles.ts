import {messageInputMinHeightPx} from "~/client/web/styles/messaging_shared_styles.js";
import {peekControlsHeight, peekMaxHeight} from "~/client/web/styles/peek_shared_styles.js";
import {
    contentStyles,
    fontSizes,
    navigationBarStyles,
    tasksStyles,
} from "~/client/web/styles/styles.js";
import {allPlatforms} from "~/shared/design/core/platform.js";
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

// A little extra margin at the bottom of the header so when we render the
// subtasks button (which renders in the margin bottom to avoid changing the
// layout) it looks good.
export const taskDetailViewHeaderMarginBottom = addRemLengths(taskDetailViewSectionGap, "1");

export const taskDetailViewDenseFieldGap = "5";
export const taskDetailViewDenseFieldMinHeight = "4";
export const taskDetailViewTitleFontSize = "300";
export const taskDetailViewTitleLineHeight = "6";
export const taskDetailViewFieldLabelColor = "grey-60";
export const taskDetailViewFieldLabelFontSize = "75";
export const taskDetailNotesFieldLabelPaddingBottom = "1";
export const taskDetailViewSubtasksFieldLabelPaddingBottom = "2";
export const taskCommentsHeaderNavigationBarSpacing = "8";

export const taskDetailViewStatusButtonSize = {
    desktopWide: "7",
    desktopNarrow: "6",
    mobileNarrow: "7",
} as const;

export const taskDetailViewStatusButtonMobilePaddingTop = "3";
export const taskDetailViewStatusButtonMobilePaddingBottom = "2";

export const taskGridViewColumnHeaderHeight = "4";

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

export const taskGridViewPaddingBottomWithNext = "6";
export const taskGridViewPaddingBottomWithoutNext = "12";

export const taskGridViewMoreUnloadedTasksHeight = addRemLengths(
    taskRowViewMinHeight,
    taskRowViewMinHeight,
    taskRowViewMinHeight,
    "4",
    "6",
    "4",
);

export const taskGridViewExplicitLoadMoreButtonHeight = addRemLengths(
    taskRowViewMinHeight,
    taskRowViewMinHeight,
    taskGridViewPaddingBottomWithoutNext,
);

export const taskCardViewMinHeight = "5.375rem";
export const taskCardViewMaxWidth = "96";

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

export const taskDetailViewMainMinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        convertRemLengthToPx(
            addRemLengths(
                navigationBarStyles.navigationBarHeight,
                taskDetailViewTitleLineHeight,
                taskDetailViewHeaderMarginBottom,
                taskDetailViewDenseFieldMinHeight,
                taskDetailViewDenseFieldGap,
                taskDetailViewDenseFieldMinHeight,
                taskDetailViewSectionGap,
                fontSizes[taskDetailViewFieldLabelFontSize].lineHeight,
                taskDetailNotesFieldLabelPaddingBottom,
            ),
            spacingScale,
        ) +
        tasksStyles.detailNotesContentEditorMinHeightPx[spacingScale] +
        convertRemLengthToPx(
            addRemLengths(
                taskDetailViewSectionGap,
                fontSizes[taskDetailViewFieldLabelFontSize].lineHeight,
                taskDetailViewSubtasksFieldLabelPaddingBottom,
            ),
            spacingScale,
        ),
);

export const taskDetailViewCommentSectionHeaderHeightPx = createObjectFromKeys(
    allPlatforms,
    platform =>
        mapObjectValues(
            taskDetailViewMainMinHeightPx,
            (taskDetailViewMainMinHeightPx, spacingScale) => {
                const peekControlsHeightPx = convertRemLengthToPx(peekControlsHeight, spacingScale);
                const peekMaxHeightPx = convertRemLengthToPx(peekMaxHeight, spacingScale);
                const taskRowViewMinHeightPx = convertRemLengthToPx(
                    taskRowViewMinHeight,
                    spacingScale,
                );
                const taskGridViewPaddingBottomWithoutNextPx = convertRemLengthToPx(
                    taskGridViewPaddingBottomWithoutNext,
                    spacingScale,
                );

                return (
                    peekMaxHeightPx -
                    peekControlsHeightPx -
                    taskDetailViewMainMinHeightPx -
                    taskRowViewMinHeightPx * 3 -
                    taskGridViewPaddingBottomWithoutNextPx -
                    messageInputMinHeightPx[platform][spacingScale]
                );
            },
        ),
);
