import {messageInputPaddingY} from "~/client/styles/messaging_shared_styles.js";
import {contentStyles, fontSizes, navigationBarStyles} from "~/client/styles/styles.js";
import {allPlatforms} from "~/shared/design/core/platform.js";
import {
    RemLength,
    addRemLengths,
    convertRemLengthToPx,
    parseRemLength,
    screenPaddingX,
    screenPaddingXRem,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {SpacingScale, allSpacingScales} from "~/shared/design/core/spacing_scale.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const postViewFlex = 6;
export const postListViewAsideFlex = 4;

export const channelViewAsideSectionGap = "7";

export const channelViewHeaderNarrowRouteLayoutMarginTop = "1";
export const channelViewHeaderSectionGap = "5";

export const postFauxInputCreateButtonMarginTop = {
    wide: "0",
    narrow: channelViewHeaderSectionGap,
} as const;

export const postFauxInputCreateButtonHeight = "12";

export const postContentViewOuterMarginY = "5";

// We also use this value as the padding X and Y padding for our post content
// editor's `<FocusRing>`. Hence why you'll see this used as X axis spacing
// values in addition to Y axis spacing values.
export const postContentViewInnerMarginY = "2";

export const postContentViewHeaderAvatarSize = "8";
export const postContentViewHeaderHeight = "8";

export const postContentViewFooterHeight = "8";
export const postContentViewFooterButtonHeight = "7";

export const screenPaddingXWithoutPostContentViewInnerMarginY = mapObjectValues(
    screenPaddingX,
    screenPaddingX => subtractRemLengths(screenPaddingX, postContentViewInnerMarginY),
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

const postContentViewOuterOpenCommentSectionMarginBottomRem = createObjectFromKeys(
    allPlatforms,
    platform =>
        postContentViewOuterMarginBottomRem - parseRemLength(messageInputPaddingY[platform]),
);
export const postContentViewOuterOpenCommentSectionMarginBottom = createObjectFromKeys(
    allPlatforms,
    (platform): RemLength =>
        `${postContentViewOuterOpenCommentSectionMarginBottomRem[platform]}rem`,
);

export const postContentViewFooterButtonIconSize = "4";

export const postCommentSectionGuidelineOffset = mapObjectValues(
    screenPaddingX,
    (paddingX): RemLength =>
        `${parseRemLength(paddingX) + parseRemLength(postContentViewFooterButtonIconSize) / 2}rem`,
);

const postCommentSectionGuidelineStartHeightRem = createObjectFromKeys(
    allPlatforms,
    platform =>
        postContentViewOuterOpenCommentSectionMarginBottomRem[platform] +
        (postContentViewFooterHeightRem - postContentViewFooterButtonHeightRem) / 2,
);
export const postCommentSectionGuidelineStartHeight = createObjectFromKeys(
    allPlatforms,
    (platform): RemLength => `${postCommentSectionGuidelineStartHeightRem[platform]}rem`,
);

// On desktop there's a bit of extra margin bottom below the navigation bar and
// post content so that when the user edits their post the focus ring won't be
// clipped by the navigation bar.
export const postViewNavigationBarSpace = {
    desktop: spacing[navigationBarStyles.navigationBarHeight],
    mobile: subtractRemLengths(
        navigationBarStyles.navigationBarHeight,
        postContentViewInnerMarginY,
    ),
};

const getPostContentViewMinHeightWithoutHeaderBasePx = (spacingScale: SpacingScale) =>
    convertRemLengthToPx(postContentViewInnerMarginY, spacingScale) +
    contentStyles.paragraphLineHeightPx[spacingScale] +
    convertRemLengthToPx(postContentViewInnerMarginY, spacingScale) +
    convertRemLengthToPx(postContentViewFooterHeight, spacingScale);

const getPostContentViewMinHeightBasePx = (spacingScale: SpacingScale) =>
    convertRemLengthToPx(postContentViewOuterMarginY, spacingScale) +
    convertRemLengthToPx(postContentViewHeaderHeight, spacingScale) +
    getPostContentViewMinHeightWithoutHeaderBasePx(spacingScale);

export const postContentViewMinHeightWithOpenCommentSectionPx = createObjectFromKeys(
    allPlatforms,
    platform =>
        createObjectFromKeys(
            allSpacingScales,
            spacingScale =>
                getPostContentViewMinHeightBasePx(spacingScale) +
                convertRemLengthToPx(
                    postContentViewOuterOpenCommentSectionMarginBottom[platform],
                    spacingScale,
                ),
        ),
);

export const postContentViewMinHeightWithClosedCommentSectionPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        getPostContentViewMinHeightBasePx(spacingScale) +
        convertRemLengthToPx(postContentViewOuterMarginBottom, spacingScale),
);

export const postViewMinHeightPx = createObjectFromKeys(
    allSpacingScales,
    spacingScale =>
        convertRemLengthToPx(navigationBarStyles.navigationBarHeight, spacingScale) +
        getPostContentViewMinHeightWithoutHeaderBasePx(spacingScale) +
        convertRemLengthToPx(postContentViewOuterMarginBottom, spacingScale),
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
