import {messageInputPaddingY} from "~/client/styles/messaging_shared_styles.js";
import {contentStyles, fontSizes, navigationBarStyles} from "~/client/styles/styles.js";
import {
    RemLength,
    addRemLengths,
    assertSpacing,
    parseRemLengthNumber,
    screenPaddingX,
    screenPaddingXRem,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const channelViewMetadataSectionGap = "7";

export const desktopLayoutPostFauxInputCreateButtonMarginTop = "1";
export const mobileLayoutPostFauxInputCreateButtonMarginTop = channelViewMetadataSectionGap;

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
    spacing[postContentViewInnerMarginY],
    spacing[postContentEditorPadding],
);

const fontSize75LineHeightRem = parseRemLengthNumber(fontSizes["75"].lineHeight);
const postContentViewFooterHeightRem = parseRemLengthNumber(spacing[postContentViewFooterHeight]);
const postContentViewFooterButtonHeightRem = parseRemLengthNumber(
    spacing[postContentViewFooterButtonHeight],
);
const postContentViewOuterMarginYRem = parseRemLengthNumber(spacing[postContentViewOuterMarginY]);

// Visually, we want `postContentViewOuterMarginY` of space from the bottom of
// the button text. So adjust our outer padding bottom to exclude footer
// height we already have.
const postContentViewOuterMarginBottomRem =
    postContentViewOuterMarginYRem - (postContentViewFooterHeightRem - fontSize75LineHeightRem) / 2;

export const postContentViewOuterMarginBottom: RemLength = `${postContentViewOuterMarginBottomRem}rem`;

const postContentViewOuterOpenCommentSectionMarginBottomRem =
    postContentViewOuterMarginBottomRem - parseRemLengthNumber(spacing[messageInputPaddingY]);

export const postContentViewOuterOpenCommentSectionMarginBottom: RemLength = `${postContentViewOuterOpenCommentSectionMarginBottomRem}rem`;

export const postContentViewFooterButtonIconSize = "4";

export const postCommentSectionGuidelineOffset = mapObjectValues(
    screenPaddingX,
    (paddingX): RemLength =>
        `${
            parseRemLengthNumber(spacing[paddingX]) +
            parseRemLengthNumber(spacing[postContentViewFooterButtonIconSize]) / 2
        }rem`,
);

const postCommentSectionGuidelineStartHeightRem =
    postContentViewOuterOpenCommentSectionMarginBottomRem +
    (postContentViewFooterHeightRem - postContentViewFooterButtonHeightRem) / 2;

export const postCommentSectionGuidelineStartHeight = `${postCommentSectionGuidelineStartHeightRem}rem`;

const postContentViewHeaderHeightRem = parseRemLengthNumber(spacing[postContentViewHeaderHeight]);

// Don't add more space to the top of a single post so when switching between a
// list of posts (probably from a channel posts notification) and a single post
// in inbox the header is in the same place.
export const desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput =
    postContentViewOuterMarginYRem;

export const desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar =
    desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput -
    (navigationBarStyles.desktopNavigationBarHeightRem - postContentViewHeaderHeightRem) / 2;

export const mobilePostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar = 0;

export const mobilePlatformPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput =
    (navigationBarStyles.mobileNavigationBarHeightRem - postContentViewHeaderHeightRem) / 2 +
    mobilePostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar;

export const mobileLayoutPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput =
    (navigationBarStyles.desktopNavigationBarHeightRem - postContentViewHeaderHeightRem) / 2 +
    mobilePostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInputAndNavigationBar;

export const desktopPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput =
    desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput +
    postContentViewHeaderHeightRem;

export const mobilePlatformPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput =
    mobilePlatformPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput +
    postContentViewHeaderHeightRem;

export const mobileLayoutPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput =
    mobileLayoutPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput +
    postContentViewHeaderHeightRem;

const postContentViewMinHeightWithoutHeaderBase = addRemLengths(
    spacing[postContentViewInnerMarginY],
    contentStyles.paragraphFontSize.lineHeight,
    spacing[postContentViewInnerMarginY],
    spacing[postContentViewFooterHeight],
);

const postContentViewMinHeightBase = addRemLengths(
    spacing[postContentViewOuterMarginY],
    spacing[postContentViewHeaderHeight],
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

export const mobilePlatformPostContentViewMinHeightWithNavigationBarAndSingleLayoutPinnedCommentInput =
    addRemLengths(
        `${mobilePlatformPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput}rem`,
        postContentViewMinHeightWithoutHeaderBase,
        postContentViewOuterMarginBottom,
    );

export const mobileLayoutPostContentViewMinHeightWithNavigationBarAndSingleLayoutPinnedCommentInput =
    addRemLengths(
        `${mobileLayoutPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput}rem`,
        postContentViewMinHeightWithoutHeaderBase,
        postContentViewOuterMarginBottom,
    );

export const desktopPostContentViewMinHeightWithNavigationBarAndSingleLayoutPinnedCommentInput =
    addRemLengths(
        `${desktopPostContentViewNavigationBarSpaceRemIfSingleLayoutWithPinnedCommentInput}rem`,
        postContentViewMinHeightWithoutHeaderBase,
        postContentViewOuterMarginBottom,
    );

export const channelViewHeaderMinHeight = addRemLengths(
    spacing[desktopLayoutPostFauxInputCreateButtonMarginTop],
    spacing[postFauxInputCreateButtonHeight],
    spacing[postContentViewOuterMarginY],
);

export const postListViewAsideMaxWidth = "96";

export const channelViewMetadataSectionTitleFontSize = "75";
export const channelViewMetadataSectionTitleColor = "grey-50";

export const channelViewAsidePostFileRowCount = 2;
export const channelViewAsidePostFileColumnCount = 2;
export const channelViewAsidePostFileCount =
    channelViewAsidePostFileRowCount * channelViewAsidePostFileColumnCount;

export const channelFilesViewFileMaxSize = "64";
export const channelFilesViewFileMinSize = "20";
export const channelFilesViewFileRowFileCount = 3;

export const channelFilesViewMaxWidth = mapObjectValues(
    screenPaddingXRem,
    (screenPaddingXRem): RemLength =>
        `${
            screenPaddingXRem * 2 +
            parseRemLengthNumber(spacing[channelFilesViewFileMaxSize]) *
                channelFilesViewFileRowFileCount +
            contentStyles.fileRowGapWidthRem * (channelFilesViewFileRowFileCount - 1)
        }rem`,
);
