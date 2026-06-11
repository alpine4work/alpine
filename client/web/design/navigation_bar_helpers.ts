// This file exists to prevent cyclic imports with `navigation_bar.tsx` in
// `client/design`. Cyclic imports degrade hot module reloading since all files in
// a cycle need to be re-evaluated. `navigation_bar.tsx` imports a bunch of files
// from `client/design` to implement the navigation bar UI. Other files in
// `client/design` shouldn't import from `navigation_bar.tsx` but should instead
// import from `navigation_bar_helpers.tsx`.

import {navigationBarStyles} from "~/client/web/styles/styles.js";
import {Spacing, subtractRemLengths} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";

const {
    navigationBarHeight,
    navigationBarHeightRem,
    navigationBarHeightWithTitleBreadcrumb,
    navigationBarHeightWithTitleBreadcrumbRem,
    navigationBarTitleBreadcrumbColor,
    navigationBarTitleBreadcrumbFontSize,
    navigationBarTitleBreadcrumbCaretSize,
    navigationBarBreadcrumbToTitleSpacing,
    navigationBarBreadcrumbInnerGap,
    navigationBarTitleBreadcrumbButtonHeight,
} = navigationBarStyles;

export {
    navigationBarHeight,
    navigationBarHeightRem,
    navigationBarHeightWithTitleBreadcrumb,
    navigationBarHeightWithTitleBreadcrumbRem,
    navigationBarTitleBreadcrumbColor,
    navigationBarTitleBreadcrumbFontSize,
    navigationBarTitleBreadcrumbCaretSize,
    navigationBarBreadcrumbToTitleSpacing,
    navigationBarBreadcrumbInnerGap,
    navigationBarTitleBreadcrumbButtonHeight,
};

{
    // IMPORTANT: If you change this value, you must also change `navigationBarHeight`
    // in `NavigationBarConstants.swift`.
    //
    // We have an assertion below to make sure this value always equals the navigation
    // bar's pixel height on mobile devices. After converting `Spacing` to an actual
    // value and applying the rem pixel count.
    const mobileNavigationBarHeight = 70;

    assert(mobileNavigationBarHeight === navigationBarHeightRem * remPxBySpacingScale.large);
}

export const navigationBarActionsFlexBasis: Spacing = "10";
export const navigationBarMobileGap: Spacing = "3";

export const navigationBarDoneButtonActionFlexBasis: Spacing = "16";
export const navigationBarDoneButtonActionWidth = subtractRemLengths(
    navigationBarDoneButtonActionFlexBasis,
    navigationBarMobileGap,
);
export const navigationBarDoneButtonActionSpacerWidth = subtractRemLengths(
    navigationBarDoneButtonActionFlexBasis,
    navigationBarActionsFlexBasis,
);

export const mobileNavigationBarActionsWidthFittingFlexBasis = subtractRemLengths(
    navigationBarActionsFlexBasis,
    navigationBarMobileGap,
);

/**
 * If we change `element.scrollTop` then by default the navigation bar will be
 * updated after a `scroll` event. However, this happens asynchronously after
 * `element.scrollTop` is changed since we go from the JavaScript main thread to
 * the async scroll thread and back (at least in browsers like WebKit). This means
 * if an `element.scrollTop` change results in the navigation bar updating its
 * styles the user may see flashes as `scroll` events are processed asynchronously!
 *
 * If you call this function after an `element.scrollTop` change then the
 * navigation bar will update synchronously so the user doesn't see janky flashes
 * of the navigation bar in an incorrect style.
 *
 * One place that needs to call this function is
 * `useTextInputVisibilityMaintainer()`. When a new paragraph or line of text is
 * added we scroll to make sure the text is still visible. Navigation bar detects
 * when the content height and scroll offset change at the same time (detecting new
 * inserted content) and maintains the position of the navigation bar. In mobile
 * WebKit if you quickly add new lines to a post (or document or anything really)
 * then the navigation bar jankiness is clearly visible as the `scroll` event is
 * processed asynchronously. [Video of the bug][1].
 *
 * [1]: https://gist.github.com/calebmer/0d1b4fd7dda8f1283f0c877ec92504dc
 */
export const flushNavigationBarScrollEventEmitter = new EventEmitter<HTMLElement>();

/**
 * When we call `scrollTo({top: newScrollTop, behavior: "smooth"})` then in mobile
 * WebKit a scroll animation will be started on iOS's UI thread. We may get scroll
 * events after a delay as iOS prioritizes animation performance.
 *
 * If this scroll would change the scroll direction then we need to update our
 * navigation bar's `scrollDirectionState` BEFORE the animation starts so our
 * sticky positioning CSS is ready for the animation. Otherwise there may be a
 * little jank in the animation as sticky positioning thinks we're scrolling in the
 * wrong direction.
 *
 * Ideally we'd call this before any
 * `scrollTo({top: newScrollTop, behavior: "smooth"})` call but since we don't want
 * to mutate `Element.prototype` instead we'll manually call this function when
 * necessary.
 *
 * Example of bug this fixes:
 * https://gist.github.com/calebmer/91334a35af1e9ee8043bea5e1c105728
 */
export const dispatchNavigationBarPrepareSmoothScrollToEventEmitter = new EventEmitter<{
    element: HTMLElement;
    scrollTop: number;
}>();
