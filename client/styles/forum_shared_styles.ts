import {messageInputPaddingY} from "~/client/styles/messaging_shared_styles.js";
import {contentStyles, fontSizes, navigationBarStyles} from "~/client/styles/styles.js";
import {
    RemLength,
    addRemLengths,
    assertSpacing,
    parseRemLength,
    screenPaddingX,
    screenPaddingXRem,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const postViewFlex = 6;
export const postListViewAsideFlex = 4;

export const channelViewAsideSectionGap = "7";

// We've picked `channelViewAsideMarginTop` so that when you edit the channel
// description the save and cancel buttons aren't covered by the navigation
// bar. If we change the design for these inline editing save/cancel buttons we
// can set `channelViewAsideMarginTop` to 0.
export const channelViewAsideMarginTop = "2";

export const channelViewHeaderNarrowRouteLayoutMarginTop = "1";
export const channelViewHeaderSectionGap = "6";

export const postFauxInputCreateButtonMarginTop = {
    wide: channelViewAsideMarginTop,
    narrow: channelViewHeaderSectionGap,
} as const;

export const postFauxInputCreateButtonHeight = "12";

export const postContentViewOuterMarginY = "5";
export const postContentViewInnerMarginY = "3";

export const postContentViewHeaderAvatarSize = "8";
export const postContentViewHeaderHeight = "8";

export const postContentViewFooterHeight = "8";
export const postContentViewFooterButtonHeight = "7";

export const postContentEditorPadding = "2";

export const screenPaddingXWithoutPostContentEditorPadding = mapObjectValues(
    screenPaddingX,
    screenPaddingX =>
        assertSpacing(`${parseFloat(screenPaddingX) - parseFloat(postContentEditorPadding)}`),
);

export const postContentViewInnerMarginYWithoutContentEditorPadding = subtractRemLengths(
    postContentViewInnerMarginY,
    postContentEditorPadding,
);

const fontSize75LineHeightRem = parseRemLength(fontSizes["75"].lineHeight);
const postContentViewFooterHeightRem = parseRemLength(postContentViewFooterHeight);
const postContentViewFooterButtonHeightRem = parseRemLength(postContentViewFooterButtonHeight);
const postContentViewOuterMarginYRem = parseRemLength(postContentViewOuterMarginY);

// Visually, we want `postContentViewOuterMarginY` of space from the bottom of
// the button text. So adjust our outer padding bottom to exclude footer
// height we already have.
const postContentViewOuterMarginBottomRem =
    postContentViewOuterMarginYRem - (postContentViewFooterHeightRem - fontSize75LineHeightRem) / 2;

export const postContentViewOuterMarginBottom: RemLength = `${postContentViewOuterMarginBottomRem}rem`;

const postContentViewOuterOpenCommentSectionMarginBottomRem =
    postContentViewOuterMarginBottomRem - parseRemLength(messageInputPaddingY);

export const postContentViewOuterOpenCommentSectionMarginBottom: RemLength = `${postContentViewOuterOpenCommentSectionMarginBottomRem}rem`;

export const postContentViewFooterButtonIconSize = "4";

export const postCommentSectionGuidelineOffset = mapObjectValues(
    screenPaddingX,
    (paddingX): RemLength =>
        `${parseRemLength(paddingX) + parseRemLength(postContentViewFooterButtonIconSize) / 2}rem`,
);

const postCommentSectionGuidelineStartHeightRem =
    postContentViewOuterOpenCommentSectionMarginBottomRem +
    (postContentViewFooterHeightRem - postContentViewFooterButtonHeightRem) / 2;

export const postCommentSectionGuidelineStartHeight = `${postCommentSectionGuidelineStartHeightRem}rem`;

export const postViewNavigationBarSpace = subtractRemLengths(
    navigationBarStyles.navigationBarHeight,
    postContentViewInnerMarginY,
);

const postContentViewMinHeightWithoutHeaderBase = addRemLengths(
    postContentViewInnerMarginY,
    contentStyles.paragraphFontSize.lineHeight,
    postContentViewInnerMarginY,
    postContentViewFooterHeight,
);

const postContentViewMinHeightBase = addRemLengths(
    postContentViewOuterMarginY,
    postContentViewHeaderHeight,
    postContentViewMinHeightWithoutHeaderBase,
);

export const postContentViewMinHeightWithOpenCommentSection = addRemLengths(
    postContentViewMinHeightBase,
    postContentViewOuterOpenCommentSectionMarginBottom,
);

export const postContentViewMinHeightWithClosedCommentSection = addRemLengths(
    postContentViewMinHeightBase,
    postContentViewOuterMarginBottom,
);

export const postViewMinHeight = addRemLengths(
    postViewNavigationBarSpace,
    postContentViewMinHeightWithoutHeaderBase,
    postContentViewOuterMarginBottom,
);

export const channelViewHeaderMinHeight = addRemLengths(
    postFauxInputCreateButtonMarginTop.wide,
    postFauxInputCreateButtonHeight,
    postContentViewOuterMarginY,
);

export const postListViewAsideMaxWidth = "96";

export const channelViewMetadataSectionTitleFontSize = "75";
export const channelViewMetadataSectionTitleColor = "grey-50";
export const channelViewMetadataSectionTitleMarginBottom = "1.5";

export const channelViewAsidePostFileRowCount = 2;
export const channelViewAsidePostFileColumnCount = 2;
export const channelViewAsidePostFileCount =
    channelViewAsidePostFileRowCount * channelViewAsidePostFileColumnCount;

export const channelViewAsideFileGap = "2";

export const channelViewAsideFileHeight: RemLength = `${
    (parseRemLength(postListViewAsideMaxWidth) -
        parseRemLength(channelViewAsideFileGap) * (channelViewAsidePostFileColumnCount - 1) -
        parseRemLength(screenPaddingX.desktop) * 2) /
    channelViewAsidePostFileColumnCount
}rem`;

export const channelFilesViewFileMaxSize = "64";
export const channelFilesViewFileMinSize = "20";
export const channelFilesViewFileRowFileCount = 3;

export const channelFilesViewMaxWidth = mapObjectValues(
    screenPaddingXRem,
    (screenPaddingXRem): RemLength =>
        `${
            screenPaddingXRem * 2 +
            parseRemLength(channelFilesViewFileMaxSize) * channelFilesViewFileRowFileCount +
            contentStyles.fileRowGapWidthRem * (channelFilesViewFileRowFileCount - 1)
        }rem`,
);
