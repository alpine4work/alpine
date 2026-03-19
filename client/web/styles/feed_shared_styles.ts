import {postViewFlex} from "~/client/web/styles/forum_shared_styles.js";
import {
    searchEntityHeaderFontSize,
    searchEntityHeaderLineHeight,
} from "~/client/web/styles/search_shared_styles.js";
import {fontSizes, navigationBarStyles} from "~/client/web/styles/styles.js";
import {FontSize} from "~/shared/design/core/fonts.js";
import {Platform} from "~/shared/design/core/platform.js";
import {
    RemLength,
    Spacing,
    addRemLengths,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";

export const feedViewSideBarLeftFlex = postViewFlex * 0.4;
export const feedViewSideBarRightMaxWidth = "64";
export const feedViewSideBarRightFlex = postViewFlex * 0.1;

export const feedViewSideBarPaddingLeft = "1";
export const feedViewSideBarSpaceNameFontSize = "400";
export const feedViewSideBarSpaceNameNegativeMarginBottom = "2";

export const feedCreateSectionHeadingFontSize: Record<Platform, FontSize> = {
    desktop: "200",
    mobile: searchEntityHeaderFontSize,
};

export const feedCreateSectionHeadingLineHeight: Record<Platform, RemLength> = {
    desktop: fontSizes[feedCreateSectionHeadingFontSize.desktop].lineHeight,
    mobile: spacing[searchEntityHeaderLineHeight],
};

export const feedCreateSectionSuggestedHeadingMarginBottom = "0";
export const feedCreateSectionForYouHeadingMarginBottom = "2";

export const feedCreateSectionGap: Record<Platform, Spacing> = {desktop: "8", mobile: "6"};

export const feedCreateSectionSearchBarContainerPaddingX = "1";
export const feedCreateSectionSearchBarContainerPaddingY = "2.5";

export const createWidgetPrimaryMenuBarItemHeight = "16";
export const createWidgetPrimaryMenuBarItemDesktopPaddingX = "5";
export const createWidgetPrimaryMenuBarItemBackgroundInsetY = "2";

export const feedCreateSectionMinHeight = {
    desktop: addRemLengths(
        navigationBarStyles.navigationBarHeight,
        subtractRemLengths(
            createWidgetPrimaryMenuBarItemHeight,
            createWidgetPrimaryMenuBarItemBackgroundInsetY,
        ),
        feedCreateSectionGap.desktop,
        feedCreateSectionHeadingLineHeight.desktop,
        feedCreateSectionForYouHeadingMarginBottom,
    ),
    mobile: addRemLengths(
        // Create section
        feedCreateSectionHeadingLineHeight.mobile,
        subtractRemLengths(
            createWidgetPrimaryMenuBarItemHeight,
            createWidgetPrimaryMenuBarItemBackgroundInsetY,
            createWidgetPrimaryMenuBarItemBackgroundInsetY,
        ),

        feedCreateSectionGap.mobile,

        // Empty suggested section
        feedCreateSectionHeadingLineHeight.mobile,
        feedCreateSectionSuggestedHeadingMarginBottom,

        feedCreateSectionGap.mobile,

        // For you section header
        feedCreateSectionHeadingLineHeight.mobile,
        feedCreateSectionForYouHeadingMarginBottom,
    ),
};
