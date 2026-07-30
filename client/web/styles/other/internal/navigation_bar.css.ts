import {keyframes, style} from "@vanilla-extract/css";
import {Color} from "~/shared/design/core/colors.js";
import {easeInQuart, easeOutQuart} from "~/shared/design/core/easing.js";
import {Platform} from "~/shared/design/core/platform.js";
import {RemLength, Spacing, addRemLengths, parseRemLength} from "~/shared/design/core/spacing.js";

// These constants are re-exported from `navigation_bar_helpers.ts` for
// convenience. Generally you'll import from there unless you need these constants
// in CSS.
export const navigationBarHeight: Spacing = "14";
export const navigationBarHeightRem = parseRemLength(navigationBarHeight);

/**
 * Extra vertical space added to the standard navigation bar height when the title
 * slot renders a breadcrumb row above the entity title. The entity title remains
 * aligned to the standard nav bar floor; this space gives the breadcrumb its own
 * row above it.
 *
 * We use font size "75" (equal to spacing "4") for the breadcrumb font size. The
 * `navigationBarBreadcrumbToTitleSpacing` (space between the breadcrumb and the
 * entity title) "0" on mobile and "1" on desktop. That's why the height is "4" on
 * mobile and "5" on desktop.
 */
const navigationBarTitleBreadcrumbExtraHeightByPlatform: Record<Platform, Spacing> = {
    mobile: "4",
    desktop: "5",
};

export const navigationBarHeightWithTitleBreadcrumb: Record<Platform, RemLength> = {
    mobile: addRemLengths(
        navigationBarHeight,
        navigationBarTitleBreadcrumbExtraHeightByPlatform.mobile,
    ),
    desktop: addRemLengths(
        navigationBarHeight,
        navigationBarTitleBreadcrumbExtraHeightByPlatform.desktop,
    ),
};

export const navigationBarHeightWithTitleBreadcrumbRem: Record<Platform, number> = {
    mobile: parseRemLength(navigationBarHeightWithTitleBreadcrumb.mobile),
    desktop: parseRemLength(navigationBarHeightWithTitleBreadcrumb.desktop),
};

export const navigationBarTitleBreadcrumbColor: Color = "grey-50";
// Can only be one of these values as they are the valid <Button/> font sizes
export const navigationBarTitleBreadcrumbFontSize: "50" | "75" | "100" | "200" = "75";
export const navigationBarTitleBreadcrumbCaretSize: Spacing = "3";
export const navigationBarBreadcrumbToTitleSpacing: Record<Platform, Spacing> = {
    mobile: "0",
    // Went back and forth between 0.5 and 1 for this. 0.5 looks nice, but when you
    // edit the title below the breadcrumb, the FocusRing just looks too close to the
    // bottom of the breadcrumb. I think this spacing still looks nice in general and
    // looks _a lot_ better when editing the title.
    desktop: "1",
};
export const navigationBarTitleBreadcrumbButtonHeight = "5" as const;
/**
 * Horizontal gap between the breadcrumb's title text and the caret icon.
 */
export const navigationBarBreadcrumbInnerGap: Spacing = "1";

const titleFadeOutKeyframes = keyframes({
    from: {opacity: 1, transform: "translateY(0rem)"},
    to: {opacity: 0, transform: "translateY(-0.25rem)"},
});

export const titleFadeOutAnimationClassName = style({
    transformOrigin: "top center",
    animation: `${titleFadeOutKeyframes} 250ms ${easeOutQuart.cubicBezier} forwards`,
});

const titleFadeInKeyframes = keyframes({
    from: {opacity: 0, transform: "translateY(-0.25rem)"},
    to: {opacity: 1, transform: "translateY(0rem)"},
});

export const titleFadeInAnimationClassName = style({
    transformOrigin: "top center",
    animation: `${titleFadeInKeyframes} 250ms ${easeInQuart.cubicBezier} forwards`,
});
