import {postViewFlex} from "~/client/styles/forum_shared_styles.js";
import {
    searchEntityHeaderFontSize,
    searchEntityHeaderLineHeight,
} from "~/client/styles/search_shared_styles.js";
import {fontSizes} from "~/client/styles/styles.js";
import {FontSize} from "~/shared/design/core/fonts.js";
import {RouteLayout, allRouteLayouts} from "~/shared/design/core/route_layout.js";
import {RemLength, Spacing, addRemLengths, spacing} from "~/shared/design/core/spacing.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";

export const feedViewSideBarLeftFlex = postViewFlex * 0.4;
export const feedViewSideBarRightMaxWidth = "48";
export const feedViewSideBarRightFlex = postViewFlex * 0.1;

export const feedViewSideBarPaddingLeft = "1";
export const feedViewSideBarSpaceNameFontSize = "400";
export const feedViewSideBarSpaceNameNegativeMarginBottom = "2";

export const feedCreateSectionMarginTop: Record<RouteLayout, Spacing> = {wide: "4", narrow: "0"};

export const feedCreateSectionHeadingFontSize: Record<RouteLayout, FontSize> = {
    wide: "200",
    narrow: searchEntityHeaderFontSize,
};

export const feedCreateSectionHeadingLineHeight: Record<RouteLayout, RemLength> = {
    wide: fontSizes[feedCreateSectionHeadingFontSize.wide].lineHeight,
    narrow: spacing[searchEntityHeaderLineHeight],
};

export const feedCreateSectionCreateHeadingMarginBottom = "0";
export const feedCreateSectionSuggestedHeadingMarginBottom = "0";
export const feedCreateSectionForYouHeadingMarginBottom = "2";

export const feedCreateSectionButtonPaddingY = "2";
export const feedCreateSectionButtonSize = "12";
export const feedCreateSectionButtonNarrowRouteLayoutGap = "1";
export const feedCreateSectionButtonFontSize: Record<RouteLayout, FontSize> = {
    wide: "100",
    narrow: "75",
};

export const feedCreateSectionButtonHeight: Record<RouteLayout, RemLength> = {
    wide: addRemLengths(
        feedCreateSectionButtonPaddingY,
        feedCreateSectionButtonSize,
        feedCreateSectionButtonPaddingY,
    ),
    narrow: addRemLengths(
        feedCreateSectionButtonPaddingY,
        feedCreateSectionButtonSize,
        feedCreateSectionButtonNarrowRouteLayoutGap,
        fontSizes[feedCreateSectionButtonFontSize.narrow].lineHeight,
        feedCreateSectionButtonPaddingY,
    ),
};

export const feedCreateSectionGap: Record<RouteLayout, Spacing> = {wide: "10", narrow: "6"};

export const feedCreateSectionMinHeight = createObjectFromKeys(allRouteLayouts, routeLayout =>
    addRemLengths(
        feedCreateSectionMarginTop[routeLayout],
        feedCreateSectionHeadingLineHeight[routeLayout],
        feedCreateSectionCreateHeadingMarginBottom,
        feedCreateSectionButtonHeight[routeLayout],
        feedCreateSectionGap[routeLayout],
        routeLayout === "narrow"
            ? addRemLengths(
                  feedCreateSectionGap[routeLayout],
                  feedCreateSectionHeadingLineHeight[routeLayout],
                  feedCreateSectionSuggestedHeadingMarginBottom,
              )
            : "0rem",
        feedCreateSectionHeadingLineHeight[routeLayout],
        feedCreateSectionForYouHeadingMarginBottom,
    ),
);
